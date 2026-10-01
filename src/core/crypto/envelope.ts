import type { Envelope } from "./types"

const encoder = new TextEncoder()
const AES_GCM_TAG_BYTES = 16
const bufferSource = (bytes: Uint8Array): ArrayBuffer =>
  bytes.slice().buffer as ArrayBuffer

export function buildAAD(
  coupleId: string,
  table: string,
  rowId: string,
  senderId: string,
  version: number,
): Uint8Array {
  const fields = [coupleId, table, rowId, senderId]
  const encoded = fields.map((field) => encoder.encode(field))
  const output = new Uint8Array(
    4 + encoded.reduce((total, field) => total + 4 + field.byteLength, 0),
  )
  const view = new DataView(output.buffer)
  view.setUint32(0, version)
  let offset = 4
  for (const field of encoded) {
    view.setUint32(offset, field.byteLength)
    offset += 4
    output.set(field, offset)
    offset += field.byteLength
  }
  return output
}

export async function encryptEnvelope(
  plaintext: Uint8Array,
  key: CryptoKey,
  aad: Uint8Array,
  keyVersion: number,
): Promise<Envelope> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bufferSource(nonce), additionalData: bufferSource(aad) },
    key,
    bufferSource(plaintext),
  ))
  return { version: 1, keyVersion, nonce, ciphertext }
}

export async function decryptEnvelope(
  envelope: Envelope,
  key: CryptoKey,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bufferSource(envelope.nonce),
        additionalData: bufferSource(aad),
      },
      key,
      bufferSource(envelope.ciphertext),
    ))
  } catch {
    throw new Error("Envelope authentication failed: AAD or ciphertext was tampered with")
  }
}

export function splitAuthTag(ciphertext: Uint8Array): {
  ciphertext: Uint8Array
  tag: Uint8Array
} {
  return {
    ciphertext: ciphertext.slice(0, -AES_GCM_TAG_BYTES),
    tag: ciphertext.slice(-AES_GCM_TAG_BYTES),
  }
}
