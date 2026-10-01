import { BIP39_ENGLISH_WORDLIST } from "./wordlist"
import { callCryptoWorker } from "./worker"

export { BIP39_ENGLISH_WORDLIST }

export function generateRecoveryPhrase(): Promise<string> {
  return callCryptoWorker<string>("generateRecoveryPhrase")
}

export function deriveRecoveryKey(phrase: string): Promise<Uint8Array> {
  if (phrase.trim().split(/\s+/u).length !== 24) {
    return Promise.reject(new Error("Recovery phrase must contain exactly 24 words"))
  }
  return callCryptoWorker<Uint8Array>("deriveRecoveryKey", phrase)
}
