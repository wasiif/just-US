import {
  buildAAD,
  decryptEnvelope,
  deriveSubkey,
  encryptEnvelope,
  type Envelope,
} from "../../core/crypto"
import { getCDK } from "../../core/keystore"

export class MessageDecryptionError extends Error {
  constructor(message = "Unable to decrypt this message") {
    super(message)
    this.name = "MessageDecryptionError"
  }
}

const utf8 = new TextEncoder()

export async function encryptMessage(
  plaintext: string,
  coupleId: string,
  senderId: string,
  messageId: string,
): Promise<Envelope> {
  const key = await deriveSubkey(await getCDK(), `just-US:messages:${coupleId}`)
  return encryptEnvelope(
    utf8.encode(plaintext),
    key,
    buildAAD(coupleId, "messages", messageId, senderId, 1),
    1,
  )
}

export async function decryptMessage(
  envelope: Envelope,
  coupleId: string,
  senderId: string,
  messageId: string,
): Promise<string> {
  try {
    const key = await deriveSubkey(await getCDK(), `just-US:messages:${coupleId}`)
    return new TextDecoder().decode(await decryptEnvelope(
      envelope,
      key,
      buildAAD(coupleId, "messages", messageId, senderId, 1),
    ))
  } catch (error) {
    if (error instanceof MessageDecryptionError) throw error
    throw new MessageDecryptionError()
  }
}
