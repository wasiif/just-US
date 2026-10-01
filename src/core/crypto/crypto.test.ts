import { beforeAll, describe, expect, it, vi } from "vitest"
import sodium from "libsodium-wrappers-sumo"
import {
  BIP39_ENGLISH_WORDLIST,
  buildAAD,
  decryptEnvelope,
  deriveRecoveryKey,
  encryptEnvelope,
  generateIdentityKeyPair,
  generateRecoveryPhrase,
  openSealed,
  sealToRecipient,
} from "./index"

beforeAll(async () => {
  await sodium.ready
  vi.stubGlobal("Worker", class {
    private listeners: Array<(event: MessageEvent) => void> = []
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") this.listeners.push(listener)
    }
    postMessage(request: { id: number; method: string; args: unknown[] }) {
      void (async () => {
        try {
          const result = (() => {
          switch (request.method) {
            case "generateIdentityKeyPair": {
              const pair = sodium.crypto_box_keypair()
              return { publicKey: pair.publicKey, privateKey: pair.privateKey }
            }
            case "generateRecoveryPhrase":
              return Array.from({ length: 24 }, () => "abandon").join(" ")
            case "deriveRecoveryKey":
              return sodium.crypto_pwhash(
                32,
                request.args[0] as string,
                sodium.crypto_generichash(16, "just-US recovery key", null),
                sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
                sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
                sodium.crypto_pwhash_ALG_ARGON2ID13,
              )
            case "sealToRecipient":
              return sodium.crypto_box_seal(
                request.args[0] as Uint8Array,
                request.args[1] as Uint8Array,
              )
            case "openSealed": {
              const pair = request.args[1] as { publicKey: Uint8Array; privateKey: Uint8Array }
              return sodium.crypto_box_seal_open(
                request.args[0] as Uint8Array,
                pair.publicKey,
                pair.privateKey,
              )
            }
            default:
              throw new Error("Unsupported test method")
          }
          })()
          for (const listener of this.listeners) {
            listener({ data: { id: request.id, result } } as MessageEvent)
          }
        } catch (error) {
          for (const listener of this.listeners) {
            listener({
              data: { id: request.id, error: error instanceof Error ? error.message : "failed" },
            } as MessageEvent)
          }
        }
      })()
    }
  })
})

async function testKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  )
}

describe("AES-GCM envelopes", () => {
  it("matches the AES-256-GCM known-answer vector", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from({ length: 32 }, (_, index) => index),
      { name: "AES-GCM" },
      false,
      ["encrypt"],
    )
    vi.spyOn(crypto, "getRandomValues").mockImplementation((bytes) => {
      const view = new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength)
      view.set(Uint8Array.from({ length: bytes.byteLength }, (_, index) => index))
      return bytes
    })
    const envelope = await encryptEnvelope(
      new TextEncoder().encode("hello"),
      key,
      new TextEncoder().encode("aad"),
      1,
    )
    expect(Array.from(envelope.ciphertext)).toEqual(
      Array.from(Uint8Array.from("2f67ba77aae321d4719670d8558f42fcccccdc4f50".match(/../g)!, (value) => Number.parseInt(value, 16))),
    )
    vi.restoreAllMocks()
  })

  it("round-trips, rejects tampered AAD, and generates unique nonces", async () => {
    const key = await testKey()
    const aad = buildAAD("couple", "messages", "row", "sender", 1)
    const plaintext = new TextEncoder().encode("private")
    const first = await encryptEnvelope(plaintext, key, aad, 1)
    const second = await encryptEnvelope(plaintext, key, aad, 1)
    expect(await decryptEnvelope(first, key, aad)).toEqual(plaintext)
    expect(first.nonce).not.toEqual(second.nonce)
    expect(first.ciphertext).not.toEqual(second.ciphertext)
    await expect(decryptEnvelope(first, key, buildAAD("other", "messages", "row", "sender", 1)))
      .rejects.toThrow("AAD")
  })
})

describe("sealed boxes and recovery phrases", () => {
  it("round-trips only for the intended recipient", async () => {
    const sender = await generateIdentityKeyPair()
    const recipient = await generateIdentityKeyPair()
    const third = await generateIdentityKeyPair()
    const message = new TextEncoder().encode("pairing secret")
    const sealed = await sealToRecipient(message, recipient.publicKey)
    expect(await openSealed(sealed, recipient)).toEqual(message)
    await expect(openSealed(sealed, third)).rejects.toThrow()
    expect(sender.privateKey).toHaveLength(32)
  })

  it("generates 24 BIP39 words and derives deterministic, distinct keys", async () => {
    const phrase = await generateRecoveryPhrase()
    const words = phrase.split(" ")
    expect(words).toHaveLength(24)
    expect(words.every((word) =>
      BIP39_ENGLISH_WORDLIST.includes(word as typeof BIP39_ENGLISH_WORDLIST[number]),
    )).toBe(true)
    expect(await deriveRecoveryKey(phrase)).toEqual(await deriveRecoveryKey(phrase))
    const differentPhrase = words.slice(0, 23).concat("ability").join(" ")
    expect(await deriveRecoveryKey(phrase)).not.toEqual(await deriveRecoveryKey(differentPhrase))
  })
})
