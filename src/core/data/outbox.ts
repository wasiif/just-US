import { v7 as uuidv7 } from "uuid"
import { db, type OutboxRow } from "./db"
import { supabase as defaultSupabase } from "../network/supabaseClient"
import type { SupabaseClient } from "@supabase/supabase-js"

const DEFAULT_MAX_ATTEMPTS = 5
let processing = false
let hooksStarted = false

export async function enqueue(
  table: string,
  payload: Record<string, unknown>,
  localId = uuidv7(),
): Promise<string> {
  await db.outbox.add({
    localId,
    table,
    payload: { ...payload, id: localId },
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  })
  return localId
}

export async function processOutbox(
  client: SupabaseClient = defaultSupabase,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<void> {
  if (processing) return
  processing = true
  try {
    const rows = await db.outbox.where("status").equals("pending").sortBy("createdAt")
    for (const row of rows) {
      try {
        const { error } = await client.from(row.table).insert(row.payload)
        if (error && !isDuplicateError(error)) throw error
        await db.outbox.update(row.localId, { status: "sent" })
        if (row.table === "messages") {
          await db.localMessages.update(row.localId, { status: "sent" })
        }
        if (row.table === "records" || row.table === "daily_answers") {
          await db.localRecords.update(row.localId, { status: "sent" })
        }
      } catch {
        const attempts = row.attempts + 1
        await db.outbox.update(row.localId, {
          attempts,
          status: attempts >= maxAttempts ? "failed" : "pending",
        })
        if (row.table === "messages" && attempts >= maxAttempts) {
          await db.localMessages.update(row.localId, { status: "failed" })
        }
        if ((row.table === "records" || row.table === "daily_answers") && attempts >= maxAttempts) {
          await db.localRecords.update(row.localId, { status: "failed" })
        }
      }
    }
  } finally {
    processing = false
  }
}

function isDuplicateError(error: { code?: string; message?: string }): boolean {
  return error.code === "23505" || /duplicate|already exists|conflict/i.test(error.message ?? "")
}

export async function retryFailed(localId: string): Promise<void> {
  const row = await db.outbox.get(localId)
  if (!row || row.status !== "failed") return
  await db.outbox.update(localId, { status: "pending", attempts: 0 })
  if (row.table === "messages") {
    await db.localMessages.update(localId, { status: "sending" })
  }
  if (row.table === "records" || row.table === "daily_answers") {
    await db.localRecords.update(localId, { status: "pending" })
  }
}

export function startOutboxProcessing(): () => void {
  if (hooksStarted || typeof window === "undefined") return () => undefined
  hooksStarted = true
  const run = () => void processOutbox()
  window.addEventListener("online", run)
  run()
  const interval = window.setInterval(run, 10_000)
  return () => {
    window.removeEventListener("online", run)
    window.clearInterval(interval)
    hooksStarted = false
  }
}

export async function getOutboxRow(localId: string): Promise<OutboxRow | undefined> {
  return db.outbox.get(localId)
}
