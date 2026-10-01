import {
  buildAAD,
  decryptEnvelope,
  deriveSubkey,
  encryptEnvelope,
  type Envelope,
} from "../../core/crypto"
import { getCDK } from "../../core/keystore"
import type { DecryptedRecord, RecordKind } from "./types"

export class RecordDecryptionError extends Error {
  constructor(message = "Unable to decrypt this record") {
    super(message)
    this.name = "RecordDecryptionError"
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function isKind(value: string): value is RecordKind {
  return ["mood", "coupon", "milestone", "gratitude"].includes(value)
}

export async function encryptRecord(
  record: DecryptedRecord,
  coupleId: string,
  recordId: string,
): Promise<Envelope> {
  const keyVersion = 1
  const key = await deriveSubkey(await getCDK(), `just-US:records:${coupleId}`)
  const { id: _id, authorId: _authorId, kind: _kind, ...payload } = record
  return encryptEnvelope(
    encoder.encode(JSON.stringify(payload)),
    key,
    buildAAD(coupleId, "records", recordId, record.authorId, keyVersion),
    keyVersion,
  )
}

export async function decryptRecord(
  envelope: Envelope,
  coupleId: string,
  recordId: string,
  authorId: string,
  kind: RecordKind,
): Promise<DecryptedRecord> {
  try {
    if (!isKind(kind)) throw new Error("Unknown record kind")
    const key = await deriveSubkey(await getCDK(), `just-US:records:${coupleId}`)
    const payload = JSON.parse(decoder.decode(await decryptEnvelope(
      envelope,
      key,
      buildAAD(coupleId, "records", recordId, authorId, envelope.keyVersion),
    ))) as Record<string, unknown>
    return { ...payload, id: recordId, authorId, kind, createdAt: Number(payload.createdAt ?? Date.now()) } as DecryptedRecord
  } catch {
    throw new RecordDecryptionError()
  }
}
