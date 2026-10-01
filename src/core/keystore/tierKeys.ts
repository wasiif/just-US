import { get, set } from "idb-keyval"
import {
  decryptEnvelope,
  encryptEnvelope,
  type Envelope,
} from "../crypto/index"

const TIER_0_KEY = "just-us:tier-0-key"
const TIER_0_AAD = new TextEncoder().encode("just-us:tier-0-key")

export class Tier0KeyNotInitializedError extends Error {
  readonly code = "tier-0-not-initialized" as const

  constructor() {
    super("Tier-0 key has not been initialized")
    this.name = "Tier0KeyNotInitializedError"
  }
}

export async function generateTier0Key(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  await set(TIER_0_KEY, key)
  return key
}

export async function getTier0Key(): Promise<CryptoKey> {
  const key = await get<CryptoKey | undefined>(TIER_0_KEY)
  if (!key) throw new Tier0KeyNotInitializedError()
  return key
}

export async function hasTier0Key(): Promise<boolean> {
  return (await get<CryptoKey | undefined>(TIER_0_KEY)) !== undefined
}

export async function wrapWithTier0(plaintext: Uint8Array): Promise<Envelope> {
  return encryptEnvelope(plaintext, await getTier0Key(), TIER_0_AAD, 0)
}

export async function unwrapWithTier0(envelope: Envelope): Promise<Uint8Array> {
  return decryptEnvelope(envelope, await getTier0Key(), TIER_0_AAD)
}
