import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabaseUrl = Deno.env.get("SUPABASE_URL")
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function environment is incomplete")
const admin = createClient(supabaseUrl, serviceRoleKey)

const { data: expired, error } = await admin
  .from("stories")
  .select("id, storage_path")
  .lt("expires_at", new Date().toISOString())
if (error) throw error

for (const story of expired ?? []) {
  const { error: removeError } = await admin.storage.from("media").remove([story.storage_path])
  if (removeError) throw removeError
  const { error: deleteError } = await admin.from("stories").delete().eq("id", story.id)
  if (deleteError) throw deleteError
}

Deno.serve(() => new Response(JSON.stringify({ deleted: expired?.length ?? 0 }), {
  headers: { "content-type": "application/json" },
}))
