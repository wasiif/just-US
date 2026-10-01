import type { SupabaseClient } from "@supabase/supabase-js"
import {
  decryptEnvelope,
  deriveRecoveryKey,
  type Envelope,
} from "../../core/crypto"
import {
  generateTier0Key,
  hasAuthenticatorCredential,
  hasTier0Key,
  registerAuthenticator,
} from "../../core/keystore"
import { persistCDK } from "../../core/keystore"
import { supabase as defaultSupabase } from "../../core/network/supabaseClient"

const BACKUP_AAD = new TextEncoder().encode("just-US:recovery-cdk:v1")

function fromBytea(value: string): Uint8Array {
  return Uint8Array.from(
    value.replace(/^\\x/u, "").match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  )
}

function parseEnvelope(value: string): Envelope {
  const decoded = new TextDecoder().decode(fromBytea(value))
  const parsed = JSON.parse(decoded) as {
    version: number
    keyVersion: number
    nonce: string
    ciphertext: string
  }
  return {
    version: parsed.version,
    keyVersion: parsed.keyVersion,
    nonce: fromBytea(parsed.nonce),
    ciphertext: fromBytea(parsed.ciphertext),
  }
}

export async function restoreFromPhrase(
  coupleId: string,
  phrase: string,
  userId: string,
  userDisplayName: string,
  client: SupabaseClient = defaultSupabase,
): Promise<Uint8Array> {
  const { data, error } = await client
    .from("key_backups")
    .select("wrapped_blob")
    .eq("couple_id", coupleId)
    .single()
  if (error || !data) {
    throw new Error(`Recovery backup fetch failed: ${error?.message ?? "not found"}`)
  }
  const rawKey = await deriveRecoveryKey(phrase)
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey.slice().buffer as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  )
  const cdk = await decryptEnvelope(parseEnvelope(data.wrapped_blob), key, BACKUP_AAD)
  if (!(await hasAuthenticatorCredential())) {
    await registerAuthenticator(userId, userDisplayName)
  }
  if (!(await hasTier0Key())) await generateTier0Key()
  await persistCDK(cdk)
  return cdk
}
