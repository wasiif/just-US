import "fake-indexeddb/auto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import sodium from "libsodium-wrappers-sumo"
import { createCoupleWithClient, joinCoupleWithClient } from "../pairing/coupleSetup"
import { createEnvelope, fetchPayload, getLocalStubs, openEnvelope, parseEnvelope } from "./repository"
import { decryptEnvelopePayload } from "./crypto"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(5)),
}))

const env = typeof process === "undefined" ? {} : process.env
const enabled = env.RUN_SUPABASE_INTEGRATION === "1"
const url = env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const password = env.SUPABASE_TEST_PASSWORD ?? `Envelope-${crypto.randomUUID()}!`

function anon() { return createClient(url, anonKey) }

async function createUser(email: string) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("No test user returned")
  return data.user
}

describe.skipIf(!enabled)("envelopes Supabase integration", () => {
  beforeAll(async () => {
    await sodium.ready
    vi.stubGlobal("Worker", class {
      private listeners: Array<(event: MessageEvent) => void> = []
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") this.listeners.push(listener)
      }
      postMessage(request: { id: number; method: string; args: unknown[] }) {
        const result = request.method === "generateIdentityKeyPair"
          ? sodium.crypto_box_keypair()
          : request.method === "generateSigningKeyPair"
            ? sodium.crypto_sign_keypair()
            : request.method === "sealToRecipient"
              ? sodium.crypto_box_seal(
                request.args[0] as Uint8Array,
                request.args[1] as Uint8Array,
              )
            : undefined
        queueMicrotask(() => this.listeners.forEach((listener) =>
          listener({ data: { id: request.id, result } } as MessageEvent)))
      }
    })
  })

  it("proves time/manual gating and unrelated-user isolation", async () => {
    const userA = await createUser(`envelope-a-${crypto.randomUUID()}@example.test`)
    const userB = await createUser(`envelope-b-${crypto.randomUUID()}@example.test`)
    const outsider = await createUser(`envelope-outsider-${crypto.randomUUID()}@example.test`)
    const clientA = anon()
    const clientB = anon()
    const clientOutsider = anon()
    await clientA.auth.signInWithPassword({ email: userA.email!, password })
    await clientB.auth.signInWithPassword({ email: userB.email!, password })
    await clientOutsider.auth.signInWithPassword({ email: outsider.email!, password })
    const couple = await createCoupleWithClient(clientA)
    await joinCoupleWithClient(clientB, couple.coupleId, {
      coupleId: couple.coupleId, publicKey: btoa("recipient"),
      signingPublicKey: btoa("recipient-signing"), pairingNonce: btoa("nonce"),
    })

    const unlockAt = new Date(Date.now() + 2_000)
    const timeId = await createEnvelope(couple.coupleId, userA.id, "time letter", "time", { unlockAt }, "Later", clientA)
    const before = await clientB.from("envelope_payloads").select("id").eq("id", timeId)
    expect(before.error).toBeNull()
    expect(before.data).toEqual([])
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    const after = await clientB.from("envelope_payloads").select("id").eq("id", timeId)
    expect(after.error).toBeNull()
    expect(after.data).toHaveLength(1)

    const manualId = await createEnvelope(couple.coupleId, userA.id, "manual letter", "manual", {}, "Ask first", clientA)
    const manualBefore = await clientB.from("envelope_payloads").select("id").eq("id", manualId)
    expect(manualBefore.data).toEqual([])
    await getLocalStubs(couple.coupleId, clientB)
    await openEnvelope(manualId, clientB)
    const manualStub = await clientB.from("envelope_stubs").select("is_unlocked, opened_at").eq("id", manualId).single()
    expect(manualStub.data?.is_unlocked).toBe(true)
    expect(manualStub.data?.opened_at).toBeTruthy()
    const opened = await fetchPayload(manualId, couple.coupleId, userA.id, clientB)
    expect(opened.body).toBe("manual letter")

    const outsiderStub = await clientOutsider.from("envelope_stubs").select("id").eq("id", manualId)
    const outsiderPayload = await clientOutsider.from("envelope_payloads").select("id").eq("id", manualId)
    expect(outsiderStub.data).toEqual([])
    expect(outsiderPayload.data).toEqual([])

    const raw = await clientB.from("envelope_payloads").select("ciphertext").eq("id", manualId).single()
    const tampered = parseEnvelope(String(raw.data?.ciphertext))
    tampered.ciphertext[0] ^= 1
    await expect(decryptEnvelopePayload(tampered, couple.coupleId, manualId, userA.id)).rejects.toThrow("Unable to decrypt")
  }, 30_000)
})
