import type { IdentityKeyPair, SigningKeyPair } from "./types"
import { callCryptoWorker } from "./worker"

export const generateIdentityKeyPair = () =>
  callCryptoWorker<IdentityKeyPair>("generateIdentityKeyPair")

export const generateSigningKeyPair = () =>
  callCryptoWorker<SigningKeyPair>("generateSigningKeyPair")

export const sealToRecipient = (plaintext: Uint8Array, recipientPublicKey: Uint8Array) =>
  callCryptoWorker<Uint8Array>("sealToRecipient", plaintext, recipientPublicKey)

export const openSealed = (sealedBox: Uint8Array, recipientKeyPair: IdentityKeyPair) =>
  callCryptoWorker<Uint8Array>("openSealed", sealedBox, recipientKeyPair)

export function generateRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("Random byte length must be a positive integer")
  }
  return crypto.getRandomValues(new Uint8Array(length))
}
