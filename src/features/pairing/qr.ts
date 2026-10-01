import {
  generateIdentityKeyPair,
  generateRandomBytes,
  generateSigningKeyPair,
} from "../../core/crypto"
import type { IdentityKeyPair, SigningKeyPair } from "../../core/crypto"
import type { PairingPayload } from "./types"

export class PairingError extends Error {
  readonly code = "invalid-pairing-payload" as const

  constructor(message: string) {
    super(message)
    this.name = "PairingError"
  }
}

export interface GeneratedPairing {
  payload: PairingPayload
  identityKeyPair: IdentityKeyPair
  signingKeyPair: SigningKeyPair
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw new PairingError("Pairing payload contains invalid base64")
  }
}

export async function generatePairingPayload(coupleId = ""): Promise<GeneratedPairing> {
  const [identityKeyPair, signingKeyPair] = await Promise.all([
    generateIdentityKeyPair(),
    generateSigningKeyPair(),
  ])
  return {
    payload: {
      coupleId,
      publicKey: bytesToBase64(identityKeyPair.publicKey),
      signingPublicKey: bytesToBase64(signingKeyPair.publicKey),
      pairingNonce: bytesToBase64(generateRandomBytes(16)),
    },
    identityKeyPair,
    signingKeyPair,
  }
}

export function encodePairingPayload(payload: PairingPayload): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(payload)))
}

export function decodePairingPayload(raw: string): PairingPayload {
  try {
    const decoded = new TextDecoder().decode(base64ToBytes(raw))
    const parsed: unknown = JSON.parse(decoded)
    if (!parsed || typeof parsed !== "object") throw new Error()
    const value = parsed as Record<string, unknown>
    const fields = ["coupleId", "publicKey", "signingPublicKey", "pairingNonce"]
    if (
      Object.keys(value).length !== fields.length ||
      fields.some((field) => typeof value[field] !== "string" || value[field] === "")
    ) throw new Error()
    for (const field of ["publicKey", "signingPublicKey", "pairingNonce"]) {
      base64ToBytes(value[field] as string)
    }
    if (!/^[0-9a-f-]{36}$/iu.test(value.coupleId as string)) throw new Error()
    return {
      coupleId: value.coupleId as string,
      publicKey: value.publicKey as string,
      signingPublicKey: value.signingPublicKey as string,
      pairingNonce: value.pairingNonce as string,
    }
  } catch (error) {
    if (error instanceof PairingError) throw error
    throw new PairingError("Pairing payload has an invalid shape")
  }
}
