import type { SupabaseClient } from "@supabase/supabase-js"
import {
  deriveRecoveryKey,
  encryptEnvelope,
  type Envelope,
} from "../../core/crypto"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"

const BACKUP_AAD = new TextEncoder().encode("just-US:recovery-cdk:v1")
const encoder = new TextEncoder()

export interface PhraseConfirmation {
  index: number
  expected: string
  entered: string
  matched: boolean
}

export function generatePhrase(): Promise<string> {
  return import("../../core/crypto").then(({ generateRecoveryPhrase }) =>
    generateRecoveryPhrase())
}

export async function deriveAndWrapCDK(
  phrase: string,
  cdk: Uint8Array,
): Promise<Envelope> {
  const rawKey = await deriveRecoveryKey(phrase)
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey.slice().buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  )
  return encryptEnvelope(cdk, key, BACKUP_AAD, 1)
}

function bytesToBytea(bytes: Uint8Array): string {
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

function envelopeToBytea(envelope: Envelope): string {
  const payload = {
    version: envelope.version,
    keyVersion: envelope.keyVersion,
    nonce: bytesToBytea(envelope.nonce),
    ciphertext: bytesToBytea(envelope.ciphertext),
  }
  return bytesToBytea(encoder.encode(JSON.stringify(payload)))
}

export async function uploadKeyBackup(
  coupleId: string,
  wrappedBlob: Envelope,
  client: SupabaseClient = defaultSupabase,
): Promise<void> {
  const { error } = await client.from("key_backups").upsert({
    couple_id: coupleId,
    wrapped_blob: envelopeToBytea(wrappedBlob),
  })
  if (error) throw new Error(`Recovery backup upload failed: ${error.message}`)
}

export function verifyPhraseConfirmation(
  phrase: string,
  userEnteredWords: string[],
  checkIndices: number[],
): PhraseConfirmation[] {
  const expectedWords = phrase.trim().split(/\s+/u)
  return checkIndices.map((index, position) => {
    const expected = expectedWords[index] ?? ""
    const entered = (userEnteredWords[position] ?? "").trim()
    return { index, expected, entered, matched: expected === entered }
  })
}
