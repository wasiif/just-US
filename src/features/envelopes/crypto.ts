import {
  buildAAD,
  decryptEnvelope,
  deriveSubkey,
  encryptEnvelope,
  type Envelope,
} from "../../core/crypto"
import { getCDK } from "../../core/keystore"

export class EnvelopeDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt this envelope")
    this.name = "EnvelopeDecryptionError"
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function encryptEnvelopePayload(
  body: string,
  coupleId: string,
  envelopeId: string,
  senderId: string,
): Promise<Envelope> {
  const keyVersion = 1
  const key = await deriveSubkey(await getCDK(), `just-US:envelopes:${coupleId}`)
  return encryptEnvelope(
    encoder.encode(body),
    key,
    buildAAD(coupleId, "envelope_payloads", envelopeId, senderId, keyVersion),
    keyVersion,
  )
}

export async function decryptEnvelopePayload(
  envelope: Envelope,
  coupleId: string,
  envelopeId: string,
  senderId: string,
): Promise<string> {
  try {
    const key = await deriveSubkey(await getCDK(), `just-US:envelopes:${coupleId}`)
    return decoder.decode(await decryptEnvelope(
      envelope,
      key,
      buildAAD(coupleId, "envelope_payloads", envelopeId, senderId, envelope.keyVersion),
    ))
  } catch {
    throw new EnvelopeDecryptionError()
  }
}
