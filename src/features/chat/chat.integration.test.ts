import { beforeAll, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { createClient } from "@supabase/supabase-js"
import sodium from "libsodium-wrappers-sumo"
vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(7)),
}))
import { db } from "../../core/data"
import { createCoupleWithClient, joinCoupleWithClient } from "../pairing/coupleSetup"
import { processOutbox } from "../../core/data"
import { sendMessage, subscribeToMessages } from "./repository"

/*
 * Requires a hosted/local Supabase project, RUN_SUPABASE_INTEGRATION=1,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TEST_PASSWORD, and
 * authenticated test users. The Worker shim only replaces browser worker
 * transport; Supabase auth, RLS, Realtime, encryption, and idempotency are real.
 */
const env = typeof process === "undefined" ? {} : process.env
const enabled = env.RUN_SUPABASE_INTEGRATION === "1"
const url = env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const password = env.SUPABASE_TEST_PASSWORD ?? `Chat-${crypto.randomUUID()}!`

function anon() {
  return createClient(url, anonKey)
}

async function createUser(email: string) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error("No test user returned")
  return data.user
}

beforeAll(async () => {
  await sodium.ready
  vi.stubGlobal("Worker", class {
    private listeners: Array<(event: MessageEvent) => void> = []
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") this.listeners.push(listener)
    }
    postMessage(request: { id: number; method: string; args: unknown[] }) {
      const result = request.method === "deriveRecoveryKey"
        ? sodium.crypto_pwhash(
          32,
          request.args[0] as string,
          sodium.crypto_generichash(16, "just-US recovery key", null),
          sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
          sodium.crypto_pwhash_ALG_ARGON2ID13,
        )
        : request.method === "generateIdentityKeyPair"
          ? sodium.crypto_box_keypair()
          : request.method === "sealToRecipient"
            ? sodium.crypto_box_seal(
              request.args[0] as Uint8Array,
              request.args[1] as Uint8Array,
            )
            : request.method === "openSealed"
              ? sodium.crypto_box_seal_open(
                request.args[0] as Uint8Array,
                (request.args[1] as { publicKey: Uint8Array; privateKey: Uint8Array }).publicKey,
                (request.args[1] as { publicKey: Uint8Array; privateKey: Uint8Array }).privateKey,
              )
              : undefined
      queueMicrotask(() => {
        for (const listener of this.listeners) {
          listener({ data: { id: request.id, result } } as MessageEvent)
        }
      })
    }
  })
})

describe.skipIf(!enabled)("chat Supabase integration", () => {
  it("sends A to B through Realtime and decrypts the exact plaintext", async () => {
    const emailA = `chat-a-${crypto.randomUUID()}@example.test`
    const emailB = `chat-b-${crypto.randomUUID()}@example.test`
    const userA = await createUser(emailA)
    await createUser(emailB)
    const clientA = anon()
    const clientB = anon()
    await clientA.auth.signInWithPassword({ email: emailA, password })
    await clientB.auth.signInWithPassword({ email: emailB, password })
    const couple = await createCoupleWithClient(clientA)
    await joinCoupleWithClient(clientB, couple.coupleId, {
      coupleId: couple.coupleId,
      publicKey: btoa("recipient"),
      signingPublicKey: btoa("recipient-signing"),
      pairingNonce: btoa("nonce"),
    })
    const coupleId = couple.coupleId
    await db.outbox.clear()
    await db.localMessages.clear()
    let unsubscribe: (() => void) | undefined
    let resolveReceived: ((body: string) => void) | undefined
    let rejectReceived: ((error: unknown) => void) | undefined
    const received = new Promise<string>((resolve, reject) => {
      resolveReceived = resolve
      rejectReceived = reject
    })
    const ready = new Promise<void>((resolve, reject) => {
      unsubscribe = subscribeToMessages(
        coupleId,
        (message) => resolveReceived?.(message.body),
        clientB,
        (status) => {
          if (status === "SUBSCRIBED") resolve()
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(new Error(`Realtime subscription failed: ${status}`))
          }
        },
        (error) => rejectReceived?.(error),
      )
    })
    await ready
    const messageId = await sendMessage(coupleId, userA.id, "end-to-end chat")
    await processOutbox(clientA)
    const queued = await db.outbox.get(messageId)
    expect(queued?.status).toBe("sent")
    await processOutbox(clientA)
    const { count, error } = await clientA
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("id", messageId)
    expect(error).toBeNull()
    expect(count).toBe(1)
    await expect(Promise.race([
      received,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(
          "Realtime did not deliver the inserted message; verify public.messages is in supabase_realtime publication",
        )), 10_000),
      ),
    ])).resolves.toBe("end-to-end chat")
    unsubscribe?.()
  }, 30_000)
})
