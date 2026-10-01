import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../network/supabaseClient"
import { db } from "./db"

export async function getCursor(table: string): Promise<number> {
  return (await db.syncCursors.get(table))?.lastServerSeq ?? 0
}

export async function setCursor(table: string, seq: number): Promise<void> {
  const current = await getCursor(table)
  if (seq > current) await db.syncCursors.put({ table, lastServerSeq: seq })
}

export async function fetchSince(
  table: string,
  afterSeq: number,
  limit = 200,
  client: SupabaseClient = defaultSupabase,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from(table)
    .select("*")
    .gt("server_seq", afterSeq)
    .order("server_seq", { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Sync catch-up failed: ${error.message}`)
  return (data ?? []) as Record<string, unknown>[]
}
