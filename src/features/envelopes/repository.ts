import { v7 as uuidv7 } from "uuid"
import type { SupabaseClient } from "@supabase/supabase-js"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"
import { db, type LocalEnvelopeStubRow } from "../../core/data"
import type { Envelope } from "../../core/crypto"
import { decryptEnvelopePayload, encryptEnvelopePayload } from "./crypto"
import type { DecryptedEnvelope, EnvelopeStub, LockType } from "./types"

export interface PlacePosition {
  lat: number
  lng: number
}

export interface EnvelopeLockParams {
  unlockAt?: Date
  unlockPlace?: { lat: number; lng: number; radiusM: number }
  unlockMood?: string
}

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

function toStub(row: Record<string, unknown>): EnvelopeStub {
  const place = row.unlock_place as { lat?: number; lng?: number; radius_m?: number } | null
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    senderId: String(row.sender_id),
    hint: row.hint ? String(row.hint) : undefined,
    lockType: String(row.lock_type) as LockType,
    unlockAt: row.unlock_at ? Date.parse(String(row.unlock_at)) : undefined,
    unlockPlace: place && typeof place.lat === "number" && typeof place.lng === "number" && typeof place.radius_m === "number"
      ? { lat: place.lat, lng: place.lng, radiusM: place.radius_m }
      : undefined,
    unlockMood: row.unlock_mood ? String(row.unlock_mood) : undefined,
    isUnlocked: Boolean(row.is_unlocked),
    openedAt: row.opened_at ? Date.parse(String(row.opened_at)) : undefined,
    createdAt: Date.parse(String(row.created_at)),
  }
}

function localStub(stub: EnvelopeStub): LocalEnvelopeStubRow {
  return { ...stub }
}

export async function createEnvelope(
  coupleId: string,
  senderId: string,
  body: string,
  lockType: LockType,
  lockParams: EnvelopeLockParams,
  hint?: string,
  client: SupabaseClient = defaultSupabase,
): Promise<string> {
  const id = uuidv7()
  const stubPayload = {
    id,
    couple_id: coupleId,
    sender_id: senderId,
    hint: hint ?? null,
    lock_type: lockType,
    unlock_at: lockParams.unlockAt?.toISOString() ?? null,
    unlock_place: lockParams.unlockPlace
      ? { lat: lockParams.unlockPlace.lat, lng: lockParams.unlockPlace.lng, radius_m: lockParams.unlockPlace.radiusM }
      : null,
    unlock_mood: lockParams.unlockMood ?? null,
  }
  const { error: stubError } = await client.from("envelope_stubs").insert(stubPayload)
  if (stubError) throw new Error(`Envelope stub creation failed: ${stubError.message}`)
  const local = toStub({ ...stubPayload, created_at: new Date().toISOString(), is_unlocked: false })
  await db.localEnvelopeStubs.put(localStub(local))
  try {
    const envelope = await encryptEnvelopePayload(body, coupleId, id, senderId)
    const { error: payloadError } = await client.from("envelope_payloads").insert({
      id,
      key_version: envelope.keyVersion,
      ciphertext: serializeEnvelope(envelope),
    })
    if (payloadError) throw payloadError
  } catch (error) {
    const { error: cleanupError } = await client.from("envelope_stubs").delete().eq("id", id)
    if (!cleanupError) await db.localEnvelopeStubs.delete(id)
    throw new Error(
      cleanupError
        ? `Envelope payload creation failed and stub cleanup was rejected for ${id}: ${error instanceof Error ? error.message : String(error)}; cleanup: ${cleanupError.message}`
        : `Envelope payload creation failed; stub ${id} was rolled back: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return id
}

export async function getLocalStubs(coupleId: string, client: SupabaseClient = defaultSupabase): Promise<EnvelopeStub[]> {
  const { data, error } = await client.from("envelope_stubs").select("*").eq("couple_id", coupleId).order("created_at", { ascending: false })
  if (error) throw new Error(`Envelope stubs fetch failed: ${error.message}`)
  const stubs = (data ?? []).map((row) => toStub(row as Record<string, unknown>))
  await db.localEnvelopeStubs.bulkPut(stubs.map(localStub))
  return stubs
}

export function subscribeToEnvelopes(
  coupleId: string,
  onStub: (stub: EnvelopeStub) => void,
  client: SupabaseClient = defaultSupabase,
  onError?: (error: unknown) => void,
): () => void {
  const channel = client.channel(`envelopes-${coupleId}`)
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "envelope_stubs",
      filter: `couple_id=eq.${coupleId}`,
    }, (payload) => {
      try {
        const stub = toStub(payload.new as Record<string, unknown>)
        void db.localEnvelopeStubs.put(localStub(stub))
        onStub(stub)
      } catch (error) {
        onError?.(error)
      }
    })
    .subscribe()
  return () => { void client.removeChannel(channel) }
}

const EARTH_RADIUS_M = 6_371_000
const radians = (degrees: number) => degrees * Math.PI / 180

export function distanceMeters(a: PlacePosition, b: PlacePosition): number {
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const latA = radians(a.lat)
  const latB = radians(b.lat)
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function checkPlaceLock(stub: EnvelopeStub, currentPosition: PlacePosition): boolean {
  return stub.lockType === "place"
    && Boolean(stub.unlockPlace)
    && distanceMeters(currentPosition, stub.unlockPlace!) <= stub.unlockPlace!.radiusM
}

export function checkMoodLock(stub: EnvelopeStub, currentMood: string): boolean {
  return stub.lockType === "mood" && stub.unlockMood === currentMood
}

export async function openEnvelope(envelopeId: string, client: SupabaseClient = defaultSupabase): Promise<void> {
  const { error } = await client.rpc("open_envelope", { envelope_id: envelopeId })
  if (error) throw new Error(`Envelope unlock failed: ${error.message}`)
  const stub = await db.localEnvelopeStubs.get(envelopeId)
  if (stub) await db.localEnvelopeStubs.put({ ...stub, isUnlocked: true, openedAt: Date.now() })
}

export async function fetchPayload(
  envelopeId: string,
  coupleId: string,
  senderId: string,
  client: SupabaseClient = defaultSupabase,
): Promise<DecryptedEnvelope> {
  const stub = await db.localEnvelopeStubs.get(envelopeId)
  if (!stub?.isUnlocked) throw new Error("Envelope is not unlocked")
  const { data, error } = await client.from("envelope_payloads").select("*").eq("id", envelopeId).single()
  if (error || !data) throw new Error(`Envelope payload fetch failed: ${error?.message ?? "not found"}`)
  const body = await decryptEnvelopePayload(
    parseEnvelope(String(data.ciphertext)),
    coupleId,
    envelopeId,
    senderId,
  )
  return { id: envelopeId, body, createdAt: stub.createdAt }
}
