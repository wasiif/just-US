import { v7 as uuidv7 } from "uuid"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import {
  db,
  enqueue,
  fetchSince,
  setCursor,
  type LocalMessageRow,
} from "../../core/data"
import type { Envelope } from "../../core/crypto"
import { decryptMessage, encryptMessage } from "./crypto"
import type { DecryptedMessage } from "./types"

function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function serializeEnvelope(envelope: Envelope): string {
  const bytes = new TextEncoder().encode(JSON.stringify({
    version: envelope.version,
    keyVersion: envelope.keyVersion,
    nonce: toBase64(envelope.nonce),
    ciphertext: toBase64(envelope.ciphertext),
  }))
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function parseEnvelope(value: string): Envelope {
  const bytes = Uint8Array.from(
    value.replace(/^\\x/u, "").match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  )
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
    version: number
    keyVersion: number
    nonce: string
    ciphertext: string
  }
  return {
    version: parsed.version,
    keyVersion: parsed.keyVersion,
    nonce: fromBase64(parsed.nonce),
    ciphertext: fromBase64(parsed.ciphertext),
  }
}

async function mergeServerMessage(
  row: Record<string, unknown>,
  onMessage?: (message: DecryptedMessage) => void,
  onError?: (error: unknown) => void,
): Promise<void> {
  const id = String(row.id)
  const coupleId = String(row.couple_id)
  const senderId = String(row.sender_id)
  const sentAt = Date.parse(String(row.created_at))
  let body: string | undefined
  let status: DecryptedMessage["status"] = "sent"
  try {
    body = await decryptMessage(
      parseEnvelope(String(row.ciphertext)),
      coupleId,
      senderId,
      id,
    )
  } catch (error) {
    onError?.(error)
    status = "failed"
  }
  const local: LocalMessageRow = {
    id,
    coupleId,
    senderId,
    body,
    sentAt,
    status,
    expiresAt: row.expires_at ? Date.parse(String(row.expires_at)) : undefined,
  }
  await db.localMessages.put(local)
  if (body !== undefined) onMessage?.({ ...local, body })
}

export async function sendMessage(
  coupleId: string,
  senderId: string,
  body: string,
): Promise<string> {
  const id = uuidv7()
  const sentAt = Date.now()
  const envelope = await encryptMessage(body, coupleId, senderId, id)
  await db.localMessages.put({ id, coupleId, senderId, body, sentAt, status: "sending" })
  await enqueue("messages", {
    id,
    couple_id: coupleId,
    sender_id: senderId,
    key_version: envelope.keyVersion,
    ciphertext: serializeEnvelope(envelope),
    created_at: new Date(sentAt).toISOString(),
  }, id)
  return id
}

export function subscribeToMessages(
  coupleId: string,
  onMessage: (message: DecryptedMessage) => void,
  client: SupabaseClient = defaultSupabase,
  onStatus?: (status: string) => void,
  onError?: (error: unknown) => void,
): () => void {
  const channel = client.channel(`messages-${coupleId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `couple_id=eq.${coupleId}`,
    }, (payload) => void mergeServerMessage(
      payload.new as Record<string, unknown>,
      onMessage,
      onError,
    ))
    .subscribe((status) => onStatus?.(status))
  return () => { void client.removeChannel(channel) }
}

export async function catchUp(coupleId: string, client: SupabaseClient = defaultSupabase): Promise<void> {
  const rows = await fetchSince("messages", await import("../../core/data").then(({ getCursor }) =>
    getCursor("messages")), 200, client)
  for (const row of rows) {
    if (String(row.couple_id) === coupleId) await mergeServerMessage(row)
    await setCursor("messages", Number(row.server_seq))
  }
}

export async function getLocalMessages(
  coupleId: string,
  limit: number,
  beforeId?: string,
): Promise<DecryptedMessage[]> {
  let rows = await db.localMessages.where("coupleId").equals(coupleId).reverse().sortBy("sentAt")
  if (beforeId) {
    const before = rows.find((row) => row.id === beforeId)?.sentAt ?? Number.POSITIVE_INFINITY
    rows = rows.filter((row) => row.sentAt < before)
  }
  return rows.slice(0, limit).reverse().map((row) => ({
    id: row.id,
    senderId: row.senderId,
    body: row.body ?? "Unable to decrypt this message",
    sentAt: row.sentAt,
    status: row.status,
    expiresAt: row.expiresAt,
  }))
}
