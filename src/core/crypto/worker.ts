import sodium from "libsodium-wrappers-sumo"
import type { IdentityKeyPair, SigningKeyPair } from "./types"
import { BIP39_ENGLISH_WORDLIST } from "./wordlist"

export type WorkerMethod =
  | "generateIdentityKeyPair"
  | "generateSigningKeyPair"
  | "generateRecoveryPhrase"
  | "deriveRecoveryKey"
  | "sealToRecipient"
  | "openSealed"

export interface WorkerRequest {
  id: number
  method: WorkerMethod
  args: unknown[]
}

export interface WorkerResponse {
  id: number
  result?: unknown
  error?: string
}

type WorkerApi = {
  generateIdentityKeyPair(): IdentityKeyPair
  generateSigningKeyPair(): SigningKeyPair
  generateRecoveryPhrase(): string
  deriveRecoveryKey(phrase: string): Uint8Array
  sealToRecipient(plaintext: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array
  openSealed(sealedBox: Uint8Array, recipientKeyPair: IdentityKeyPair): Uint8Array
}

function randomPhrase(): string {
  const values = new Uint32Array(24)
  crypto.getRandomValues(values)
  return Array.from(values, (value) =>
    BIP39_ENGLISH_WORDLIST[value % BIP39_ENGLISH_WORDLIST.length],
  ).join(" ")
}

async function getApi(): Promise<WorkerApi> {
  await sodium.ready
  return {
    generateIdentityKeyPair: () => {
      const pair = sodium.crypto_box_keypair()
      return { publicKey: pair.publicKey, privateKey: pair.privateKey }
    },
    generateSigningKeyPair: () => {
      const pair = sodium.crypto_sign_keypair()
      return { publicKey: pair.publicKey, privateKey: pair.privateKey }
    },
    generateRecoveryPhrase: randomPhrase,
    deriveRecoveryKey: (phrase) => {
      const salt = sodium.crypto_generichash(16, "just-US recovery key", null)
      return sodium.crypto_pwhash(
        32,
        phrase.normalize("NFKC"),
        salt,
        sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
        sodium.crypto_pwhash_ALG_ARGON2ID13,
      )
    },
    sealToRecipient: (plaintext, recipientPublicKey) =>
      sodium.crypto_box_seal(plaintext, recipientPublicKey),
    openSealed: (sealedBox, recipientKeyPair) =>
      sodium.crypto_box_seal_open(
        sealedBox,
        recipientKeyPair.publicKey,
        recipientKeyPair.privateKey,
      ),
  }
}

let nextRequestId = 0
const pending = new Map<number, {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}>()
let worker: Worker | undefined

function getWorker(): Worker {
  worker ??= new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.error) request.reject(new Error(event.data.error))
    else request.resolve(event.data.result)
  })
  worker.addEventListener("error", (event) => {
    for (const request of pending.values()) request.reject(new Error(event.message))
    pending.clear()
  })
  return worker
}

export function callCryptoWorker<T>(method: WorkerMethod, ...args: unknown[]): Promise<T> {
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (value) => resolve(value as T), reject })
    getWorker().postMessage({ id, method, args } satisfies WorkerRequest)
  })
}

const isWorkerScope =
  (globalThis as { constructor: { name: string } }).constructor.name.includes("Worker")

if (isWorkerScope) {
  const scope = globalThis as unknown as {
    addEventListener: (
      type: string,
      listener: (event: MessageEvent<WorkerRequest>) => void,
    ) => void
    postMessage: (message: WorkerResponse) => void
  }
  scope.addEventListener("message", async (event) => {
    try {
      const api = await getApi()
      let result: unknown
      switch (event.data.method) {
        case "generateIdentityKeyPair":
          result = api.generateIdentityKeyPair()
          break
        case "generateSigningKeyPair":
          result = api.generateSigningKeyPair()
          break
        case "generateRecoveryPhrase":
          result = api.generateRecoveryPhrase()
          break
        case "deriveRecoveryKey":
          result = api.deriveRecoveryKey(event.data.args[0] as string)
          break
        case "sealToRecipient":
          result = api.sealToRecipient(
            event.data.args[0] as Uint8Array,
            event.data.args[1] as Uint8Array,
          )
          break
        case "openSealed":
          result = api.openSealed(
            event.data.args[0] as Uint8Array,
            event.data.args[1] as IdentityKeyPair,
          )
          break
      }
      scope.postMessage({ id: event.data.id, result } satisfies WorkerResponse)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Crypto worker operation failed"
      scope.postMessage({ id: event.data.id, error: message } satisfies WorkerResponse)
    }
  })
}
