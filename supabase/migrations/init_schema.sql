-- ============================================================================
-- "Us" — initial schema
-- Two-person couple model, E2EE content, server sees ciphertext only.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Core identity: couples, members, profiles
-- ----------------------------------------------------------------------------

create table couples (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status     text not null default 'active'
             check (status in ('active', 'leaving', 'purge_pending'))
);

create table couple_members (
  couple_id uuid not null references couples(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  slot      smallint not null check (slot in (1, 2)),
  joined_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  unique (couple_id, slot),   -- at most two members per couple
  unique (user_id)            -- a user belongs to exactly one couple
);

-- Central membership check, reused in every policy below.
create function public.is_couple_member(cid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.couple_members m
    where m.couple_id = cid and m.user_id = (select auth.uid())
  );
$$;

-- Non-sensitive profile data (identity color, display name, theme prefs).
create table profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  couple_id      uuid not null references couples(id) on delete cascade,
  display_name   text not null,
  identity_color text not null default '#4A6FE0',
  theme_prefs    jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Keys: device-wrapped CDK + recovery backup (opaque to the server)
-- ----------------------------------------------------------------------------

create table couple_keys (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references couples(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_version  int  not null default 1,
  wrapped_cdk  bytea not null,     -- CDK sealed to this device's public key
  created_at   timestamptz not null default now()
);

create table key_backups (
  couple_id       uuid primary key references couples(id) on delete cascade,
  wrapped_blob    bytea not null,  -- CDK wrapped by the Argon2id recovery key
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Push (Web Push / VAPID, not FCM)
-- ----------------------------------------------------------------------------

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh_key text not null,
  auth_key   text not null,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Messages (chat, high volume, cursor-synced)
-- ----------------------------------------------------------------------------

create table messages (
  id          uuid primary key,               -- client-generated UUIDv7
  couple_id   uuid not null references couples(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  key_version int  not null default 1,
  ciphertext  bytea not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,                     -- disappearing messages, nullable
  server_seq  bigint generated always as identity
);

create index messages_couple_seq_idx on messages (couple_id, server_seq);

-- ----------------------------------------------------------------------------
-- Media: permanent gallery (photos/video/voice attached in normal chat)
-- ----------------------------------------------------------------------------

create table media_assets (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references couples(id) on delete cascade,
  sender_id    uuid not null references auth.users(id),
  kind         text not null check (kind in ('photo', 'video', 'audio')),
  storage_path text not null,     -- {couple_id}/{asset_id}.enc
  thumb_path   text,              -- {couple_id}/{asset_id}.thumb.enc
  size_bytes   bigint,
  created_at   timestamptz not null default now()
);

create index media_assets_couple_created_idx on media_assets (couple_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Stories: explicit 24h ephemeral feed (separate from permanent gallery)
-- ----------------------------------------------------------------------------

create table stories (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references couples(id) on delete cascade,
  sender_id    uuid not null references auth.users(id),
  storage_path text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '24 hours')
);

create index stories_couple_expiry_idx on stories (couple_id, expires_at);

-- ----------------------------------------------------------------------------
-- Records: generic encrypted rows for small features (typed by `kind`)
-- mood | answer | coupon | milestone | gratitude | checklist_item ...
-- ----------------------------------------------------------------------------

create table records (
  id          uuid primary key,
  couple_id   uuid not null references couples(id) on delete cascade,
  author_id   uuid not null references auth.users(id),
  kind        text not null,
  key_version int  not null default 1,
  ciphertext  bytea not null,
  unlock_at   timestamptz,        -- server-enforced time lock, e.g. daily answers
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  server_seq  bigint generated always as identity
);

create index records_couple_kind_idx on records (couple_id, kind);
create index records_couple_seq_idx on records (couple_id, server_seq);

create table daily_answers (
  id           uuid primary key,
  couple_id    uuid not null references couples(id) on delete cascade,
  author_id    uuid not null references auth.users(id),
  question_id  text not null,
  prompt_date  date not null,
  key_version  int not null default 1,
  ciphertext   bytea not null,
  unlock_at    timestamptz,
  created_at   timestamptz not null default now(),
  server_seq   bigint generated always as identity,
  unique (couple_id, author_id, question_id, prompt_date)
);

create index daily_answers_lookup_idx
  on daily_answers (couple_id, question_id, prompt_date);

-- ----------------------------------------------------------------------------
-- Sealed envelopes: stub (visible) + payload (gated)
-- ----------------------------------------------------------------------------

create table envelope_stubs (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references couples(id) on delete cascade,
  sender_id     uuid not null references auth.users(id),
  hint          text,
  lock_type     text not null check (lock_type in ('time', 'place', 'mood', 'manual')),
  unlock_at     timestamptz,      -- used when lock_type = 'time'
  unlock_place  jsonb,            -- { lat, lng, radius_m } when lock_type = 'place'
  unlock_mood   text,             -- when lock_type = 'mood'
  is_unlocked   boolean not null default false,
  opened_at     timestamptz,
  created_at    timestamptz not null default now()
);

create table envelope_payloads (
  id          uuid primary key references envelope_stubs(id) on delete cascade,
  key_version int  not null default 1,
  ciphertext  bytea not null,
  created_at  timestamptz not null default now()
);

-- Server-side RPC for opening a manual/mood envelope — the client can only
-- flip `is_unlocked` through this function, never by a raw UPDATE, so the
-- stub's other fields (hint, lock_type, sender_id) can't be tampered with.
create function public.open_envelope(envelope_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.envelope_stubs
  set is_unlocked = true, opened_at = now()
  where id = envelope_id
    and public.is_couple_member(couple_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Special days: user-defined celebrations, no code deploy needed to add one
-- ----------------------------------------------------------------------------

create table special_days (
  id                   uuid primary key default gen_random_uuid(),
  couple_id            uuid not null references couples(id) on delete cascade,
  created_by           uuid not null references auth.users(id),
  label                text not null,                 -- "Our anniversary"
  date_type            text not null check (date_type in ('annual', 'one_time')),
  anchor_date          date not null,                  -- month/day repeats if 'annual'
  theme_key            text,                           -- e.g. 'valentines', 'birthday'
  celebration_trigger  text not null default 'confetti'
                       check (celebration_trigger in ('confetti', 'midnight_reveal', 'theme_only', 'none')),
  created_at           timestamptz not null default now()
);

create index special_days_couple_idx on special_days (couple_id);

-- Tables whose changes are consumed by live feature subscriptions. Realtime
-- still applies each table's RLS policies to every subscriber.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'couple_keys',
    'daily_answers',
    'messages',
    'media_assets',
    'stories',
    'records',
    'envelope_stubs',
    'special_days'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end
$$;

-- ----------------------------------------------------------------------------
-- updated_at trigger (reused on a couple of tables)
-- ----------------------------------------------------------------------------

create function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on profiles
  for each row execute function public.set_updated_at();
create trigger records_touch before update on records
  for each row execute function public.set_updated_at();
create trigger key_backups_touch before update on key_backups
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row-Level Security — enabled on every table, no exceptions
-- ============================================================================

alter table couples             enable row level security;
alter table couple_members      enable row level security;
alter table profiles            enable row level security;
alter table couple_keys         enable row level security;
alter table key_backups         enable row level security;
alter table push_subscriptions  enable row level security;
alter table messages            enable row level security;
alter table media_assets        enable row level security;
alter table stories             enable row level security;
alter table records             enable row level security;
alter table daily_answers       enable row level security;
alter table envelope_stubs      enable row level security;
alter table envelope_payloads   enable row level security;
alter table special_days        enable row level security;

-- couples / couple_members
create policy couples_select on couples for select
  using (public.is_couple_member(id));

create policy couple_members_select on couple_members for select
  using (public.is_couple_member(couple_id));

-- profiles: both partners can read each other's; only the owner writes
create policy profiles_select on profiles for select
  using (public.is_couple_member(couple_id));
create policy profiles_write on profiles for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- couple_keys / key_backups: couple members may address keys only to members
create policy couple_keys_select on couple_keys for select
  using (public.is_couple_member(couple_id));
create policy couple_keys_insert on couple_keys for insert
  with check (
    public.is_couple_member(couple_id)
    and exists (
      select 1 from couple_members m
      where m.couple_id = couple_keys.couple_id
        and m.user_id = couple_keys.user_id
    )
  );

create policy key_backups_all on key_backups for all
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

-- push_subscriptions: strictly own rows, partner never sees your endpoint
create policy push_subscriptions_own on push_subscriptions for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- messages
create policy messages_select on messages for select
  using (public.is_couple_member(couple_id));
create policy messages_insert on messages for insert
  with check (public.is_couple_member(couple_id) and sender_id = (select auth.uid()));
create policy messages_update_own on messages for update
  using (sender_id = (select auth.uid()));

-- media_assets / stories
create policy media_select on media_assets for select
  using (public.is_couple_member(couple_id));
create policy media_insert on media_assets for insert
  with check (public.is_couple_member(couple_id) and sender_id = (select auth.uid()));

create policy stories_select on stories for select
  using (public.is_couple_member(couple_id) and expires_at > now());
create policy stories_insert on stories for insert
  with check (public.is_couple_member(couple_id) and sender_id = (select auth.uid()));


create policy records_select on records for select
  using (
    public.is_couple_member(couple_id)
    and (unlock_at is null or unlock_at <= now() or author_id = (select auth.uid()))
  );
create policy records_insert on records for insert
  with check (public.is_couple_member(couple_id) and author_id = (select auth.uid()));
create policy records_update_own on records for update
  using (author_id = (select auth.uid()));
create policy records_coupon_redeem on records for update
  using (kind = 'coupon' and public.is_couple_member(couple_id))
  with check (kind = 'coupon' and public.is_couple_member(couple_id));

create or replace function public.viewer_has_answered(
  target_couple_id uuid,
  target_question_id text,
  target_prompt_date date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.daily_answers
    where couple_id = target_couple_id
      and question_id = target_question_id
      and prompt_date = target_prompt_date
      and author_id = (select auth.uid())
  );
$$;

create policy daily_answers_select on daily_answers for select
  using (
    public.is_couple_member(couple_id)
    and (
      author_id = (select auth.uid())
      or public.viewer_has_answered(couple_id, question_id, prompt_date)
    )
  );
create policy daily_answers_insert on daily_answers for insert
  with check (public.is_couple_member(couple_id) and author_id = (select auth.uid()));

-- envelope_stubs: always visible to both (safe — no payload here)
create policy envelope_stubs_select on envelope_stubs for select
  using (public.is_couple_member(couple_id));
create policy envelope_stubs_insert on envelope_stubs for insert
  with check (public.is_couple_member(couple_id) and sender_id = (select auth.uid()));
-- no direct update policy — unlocking goes through open_envelope() only

-- envelope_payloads: gated by the stub's unlock state
create policy envelope_payloads_select on envelope_payloads for select
  using (
    exists (
      select 1 from envelope_stubs s
      where s.id = envelope_payloads.id
        and public.is_couple_member(s.couple_id)
        and (
          s.is_unlocked = true
          or (s.lock_type = 'time' and s.unlock_at is not null and s.unlock_at <= now())
        )
    )
  );
create policy envelope_payloads_insert on envelope_payloads for insert
  with check (
    exists (
      select 1 from envelope_stubs s
      where s.id = envelope_payloads.id
        and s.sender_id = (select auth.uid())
    )
  );

-- special_days
create policy special_days_all on special_days for all
  using (public.is_couple_member(couple_id))
  with check (public.is_couple_member(couple_id));

-- ============================================================================
-- Storage: private "media" bucket, path convention {couple_id}/{asset_id}[.thumb].enc
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_bucket_select on storage.objects for select
  using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

create policy media_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

create policy media_bucket_delete on storage.objects for delete
  using (
    bucket_id = 'media'
    and public.is_couple_member(((storage.foldername(name))[1])::uuid)
  );

-- Any authenticated user can create a new couple shell —
-- this is the entry point, there's nothing to check membership against yet.
create policy couples_insert on couples for insert
  with check ((select auth.uid()) is not null);

-- A user can only ever insert themselves as a member, never someone else.
-- The UNIQUE(couple_id, slot) and UNIQUE(user_id) constraints already in
-- the schema are what actually prevent a 3rd member or double-joining —
-- this policy just stops user A from inserting user B's row.

create policy couple_members_insert on couple_members for insert
  with check (user_id = (select auth.uid()));
-- ============================================================================
-- Realtime: restrict private couple channels to their own members
-- (Configure in Realtime Authorization settings / policies on realtime.messages
--  if using Broadcast/Presence with private channels — topic must equal
--  'couple:' || couple_id for a couple the caller belongs to.)
-- ============================================================================