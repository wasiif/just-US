import {
  buildAAD,
  decryptEnvelope,
  deriveSubkey,
  encryptEnvelope,
  type Envelope,
} from "../../core/crypto"
import { getCDK } from "../../core/keystore"

export class MediaDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt media")
    this.name = "MediaDecryptionError"
  }
}

const toBytes = (value: ArrayBuffer) => new Uint8Array(value)
const keyFor = async (coupleId: string) => deriveSubkey(await getCDK(), `just-US:media:${coupleId}`)

export async function encryptMediaFile(
  blob: Blob,
  coupleId: string,
  assetId: string,
  senderId: string,
  table = "media_assets",
): Promise<Uint8Array> {
  const envelope = await encryptEnvelope(
    toBytes(await blob.arrayBuffer()),
    await keyFor(coupleId),
    buildAAD(coupleId, table, assetId, senderId, 1),
    1,
  )
  return serializeEnvelope(envelope)
}

export async function decryptMediaFile(
  encryptedBytes: Uint8Array,
  coupleId: string,
  assetId: string,
  senderId: string,
  mimeType = "application/octet-stream",
  table = "media_assets",
): Promise<Blob> {
  try {
    const envelope = parseEnvelope(encryptedBytes)
    const bytes = await decryptEnvelope(
      envelope,
      await keyFor(coupleId),
      buildAAD(coupleId, table, assetId, senderId, envelope.keyVersion),
    )
    const blobBytes = new Uint8Array(bytes.byteLength)
    blobBytes.set(bytes)
    return new Blob([blobBytes.buffer], { type: mimeType })
  } catch {
    throw new MediaDecryptionError()
  }
}

export const serializeEnvelope = (envelope: Envelope): Uint8Array => {
  const toBase64 = (bytes: Uint8Array) => {
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  return new TextEncoder().encode(JSON.stringify({
    version: envelope.version,
    keyVersion: envelope.keyVersion,
    nonce: toBase64(envelope.nonce),
    ciphertext: toBase64(envelope.ciphertext),
  }))
}

export function parseEnvelope(bytes: Uint8Array): Envelope {
  const fromBase64 = (value: string) => {
    const binary = atob(value)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  }
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
