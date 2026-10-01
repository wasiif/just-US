import { v7 as uuidv7 } from "uuid"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import { db, enqueue, fetchSince, getCursor, setCursor, type LocalRecordRow } from "../../core/data"
import type { Envelope } from "../../core/crypto"
import { decryptRecord, encryptRecord } from "./crypto"
import type { DecryptedRecord, RecordKind, CouponRecord } from "./types"

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function serializeEnvelope(envelope: Envelope): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    version: envelope.version,
    keyVersion: envelope.keyVersion,
    nonce: toBase64(envelope.nonce),
    ciphertext: toBase64(envelope.ciphertext),
  }))
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export function parseEnvelope(value: string): Envelope {
  const bytes = Uint8Array.from(
    value.replace(/^\\x/u, "").match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  )
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    version: number; keyVersion: number; nonce: string; ciphertext: string
  }
  return {
    version: parsed.version,
    keyVersion: parsed.keyVersion,
    nonce: fromBase64(parsed.nonce),
    ciphertext: fromBase64(parsed.ciphertext),
  }
}

async function mergeServerRecord(row: Record<string, unknown>, onRecord?: (record: DecryptedRecord) => void): Promise<void> {
  const id = String(row.id)
  const kind = String(row.kind) as RecordKind
  try {
    const record = await decryptRecord(
      parseEnvelope(String(row.ciphertext)),
      String(row.couple_id),
      id,
      String(row.author_id),
      kind,
    )
    const local: LocalRecordRow = {
      id,
      coupleId: String(row.couple_id),
      authorId: String(row.author_id),
      kind,
      createdAt: Date.parse(String(row.created_at)),
      record: record as unknown as Record<string, unknown>,
      status: "sent",
    }
    await db.localRecords.put(local)
    onRecord?.(record)
  } catch {
    await db.localRecords.put({
      id,
      coupleId: String(row.couple_id),
      authorId: String(row.author_id),
      kind,
      createdAt: Date.parse(String(row.created_at)),
      status: "failed",
    })
  }
}

export async function createRecord(
  coupleId: string,
  authorId: string,
  record: DecryptedRecord,
  options: { unlockAt?: Date } = {},
): Promise<string> {
  const id = record.id || uuidv7()
  const envelope = await encryptRecord({ ...record, id, authorId, createdAt: record.createdAt || Date.now() }, coupleId, id)
  const createdAt = record.createdAt || Date.now()
  await db.localRecords.put({
    id,
    coupleId,
    authorId,
    kind: record.kind,
    createdAt,
    record: { ...record, id, authorId, createdAt } as unknown as Record<string, unknown>,
    status: "pending",
  })
  await enqueue("records", {
    id,
    couple_id: coupleId,
    author_id: authorId,
    kind: record.kind,
    key_version: envelope.keyVersion,
    ciphertext: serializeEnvelope(envelope),
    unlock_at: options.unlockAt?.toISOString() ?? null,
  }, id)
  return id
}

export function subscribeToRecords(
  coupleId: string,
  kind: RecordKind | "all",
  onRecord: (record: DecryptedRecord) => void,
  client: SupabaseClient = defaultSupabase,
): () => void {
  const channel = client.channel(`records-${coupleId}-${kind}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "records",
      filter: `couple_id=eq.${coupleId}`,
    }, (payload) => {
      const row = payload.new as Record<string, unknown>
      if (kind === "all" || String(row.kind) === kind) {
        void mergeServerRecord(row, onRecord)
      }
    })
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

export async function getLocalRecords(coupleId: string, kind: RecordKind | "all"): Promise<DecryptedRecord[]> {
  const rows = await db.localRecords.where("coupleId").equals(coupleId).sortBy("createdAt")
  return rows
    .filter((row) => kind === "all" || row.kind === kind)
    .filter((row): row is LocalRecordRow & { record: Record<string, unknown> } => Boolean(row.record))
    .map((row) => row.record as unknown as DecryptedRecord)
}

export async function catchUpRecords(coupleId: string, client: SupabaseClient = defaultSupabase): Promise<void> {
  const rows = await fetchSince("records", await getCursor("records"), 200, client)
  for (const row of rows) {
    if (String(row.couple_id) === coupleId) await mergeServerRecord(row)
    await setCursor("records", Number(row.server_seq))
  }
}

export async function toggleCouponRedeemed(
  recordId: string,
  client: SupabaseClient = defaultSupabase,
): Promise<void> {
  let row = await db.localRecords.get(recordId)
  if (!row?.record) {
    const { data, error } = await client.from("records").select("*").eq("id", recordId).single()
    if (error || !data) throw new Error(`Coupon record is not available: ${error?.message ?? "not found"}`)
    await mergeServerRecord(data as Record<string, unknown>)
    row = await db.localRecords.get(recordId)
  }
  if (!row?.record || row.kind !== "coupon") throw new Error("Coupon record is not available locally")
  const coupon = row.record as unknown as CouponRecord
  const updated: CouponRecord = { ...coupon, redeemed: true, redeemedAt: Date.now() }
  const envelope = await encryptRecord(updated, row.coupleId, recordId)
  const { error } = await client.from("records").update({
    ciphertext: serializeEnvelope(envelope),
    key_version: envelope.keyVersion,
    updated_at: new Date().toISOString(),
  }).eq("id", recordId)
  if (error) throw new Error(`Coupon redemption failed: ${error.message}`)
  await db.localRecords.put({ ...row, record: updated as unknown as Record<string, unknown>, status: "sent" })
}
