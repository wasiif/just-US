import { beforeAll, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { createClient } from "@supabase/supabase-js"
import sodium from "libsodium-wrappers-sumo"
import { createCoupleWithClient, joinCoupleWithClient } from "../pairing/coupleSetup"
import { db, processOutbox } from "../../core/data"
import { decryptDailyAnswer, parseEnvelope, submitDailyAnswer, subscribeToDailyAnswers } from "./dailyAnswers"
import { createRecord, toggleCouponRedeemed } from "./repository"
import type { CouponRecord, DailyAnswer } from "./types"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9)),
}))

const env = typeof process === "undefined" ? {} : process.env
const enabled = env.RUN_SUPABASE_INTEGRATION === "1"
const url = env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const password = env.SUPABASE_TEST_PASSWORD ?? `Records-${crypto.randomUUID()}!`

function anon() { return createClient(url, anonKey) }
async function createUser(email: string) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error("No test user returned")
  return data.user
}

describe.skipIf(!enabled)("records and daily answers Supabase integration", () => {
  beforeAll(async () => {
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
    await sodium.ready
    vi.stubGlobal("Worker", class {
      private listeners: Array<(event: MessageEvent) => void> = []
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") this.listeners.push(listener)
      }
      postMessage(request: { id: number; method: string; args: unknown[] }) {
        const result = request.method === "generateIdentityKeyPair"
          ? sodium.crypto_box_keypair()
          : request.method === "sealToRecipient"
            ? sodium.crypto_box_seal(request.args[0] as Uint8Array, request.args[1] as Uint8Array)
            : request.method === "openSealed"
              ? sodium.crypto_box_seal_open(
                request.args[0] as Uint8Array,
                (request.args[1] as { publicKey: Uint8Array }).publicKey,
                (request.args[1] as { privateKey: Uint8Array }).privateKey,
              )
              : undefined
        queueMicrotask(() => this.listeners.forEach((listener) =>
          listener({ data: { id: request.id, result } } as MessageEvent)))
      }
    })
  })

  it("proves blind visibility, uniqueness, live unlock delivery, and receiver coupon redemption", async () => {
    const userA = await createUser(`records-a-${crypto.randomUUID()}@example.test`)
    const userB = await createUser(`records-b-${crypto.randomUUID()}@example.test`)
    const clientA = anon()
    const clientB = anon()
    await clientA.auth.signInWithPassword({ email: userA.email!, password })
    await clientB.auth.signInWithPassword({ email: userB.email!, password })
    const couple = await createCoupleWithClient(clientA)
    await joinCoupleWithClient(clientB, couple.coupleId, {
      coupleId: couple.coupleId, publicKey: btoa("recipient"),
      signingPublicKey: btoa("recipient-signing"), pairingNonce: btoa("nonce"),
    })
    await db.outbox.clear()
    await db.localRecords.clear()

    const answerA: DailyAnswer = {
      id: crypto.randomUUID(), coupleId: couple.coupleId, authorId: userA.id,
      questionId: "q", answer: "A", promptDate: "2026-10-01", createdAt: Date.now(),
    }
    await submitDailyAnswer(answerA)
    await processOutbox(clientA)
    const own = await clientA.from("daily_answers").select("id").eq("id", answerA.id)
    expect(own.error).toBeNull()
    expect(own.data).toHaveLength(1)
    const hidden = await clientB.from("daily_answers").select("id, ciphertext").eq("id", answerA.id)
    expect(hidden.error).toBeNull()
    expect(hidden.data).toEqual([])

    const duplicate = await clientA.from("daily_answers").insert({
      id: crypto.randomUUID(), couple_id: couple.coupleId, author_id: userA.id,
      question_id: "q", prompt_date: "2026-10-01", key_version: 1,
      ciphertext: "\\x00",
    })
    expect(duplicate.error?.code).toBe("23505")

    const answerB: DailyAnswer = {
      id: crypto.randomUUID(), coupleId: couple.coupleId, authorId: userB.id,
      questionId: "q", answer: "B", promptDate: "2026-10-01", createdAt: Date.now(),
    }
    let resolveLive: ((answer: DailyAnswer) => void) | undefined
    const live = new Promise<DailyAnswer>((resolve) => { resolveLive = resolve })
    const stop = subscribeToDailyAnswers(couple.coupleId, resolveLive!, clientA)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await submitDailyAnswer(answerB)
    await processOutbox(clientB)
    const liveAnswer = await Promise.race([
      live,
      new Promise<DailyAnswer>((_, reject) => setTimeout(() => reject(new Error("daily_answers Realtime unlock delivery timed out")), 10_000)),
    ])
    expect(liveAnswer.answer).toBe("B")
    stop()

    const visibleA = await clientA.from("daily_answers").select("id").in("id", [answerA.id, answerB.id])
    const visibleB = await clientB.from("daily_answers").select("id").in("id", [answerA.id, answerB.id])
    expect(visibleA.data).toHaveLength(2)
    expect(visibleB.data).toHaveLength(2)
    const fullRows = await clientA.from("daily_answers").select("*").in("id", [answerA.id, answerB.id])
    expect(fullRows.error).toBeNull()
    for (const row of fullRows.data ?? []) {
      const decrypted = await decryptDailyAnswer(
        parseEnvelope(String(row.ciphertext)),
        String(row.couple_id),
        String(row.id),
        String(row.author_id),
        Date.parse(String(row.created_at)),
        String(row.question_id),
        String(row.prompt_date),
      )
      expect(["A", "B"]).toContain(decrypted.answer)
    }

    const coupon: CouponRecord = {
      id: crypto.randomUUID(), authorId: userA.id, createdAt: Date.now(),
      kind: "coupon", title: "Dinner", description: "Dinner", redeemed: false,
    }
    await createRecord(couple.coupleId, userA.id, coupon)
    await processOutbox(clientA)
    await expect(toggleCouponRedeemed(coupon.id, clientB)).resolves.toBeUndefined()
    const redeemed = await clientA.from("records").select("id, ciphertext").eq("id", coupon.id).single()
    expect(redeemed.error).toBeNull()
    expect(redeemed.data?.id).toBe(coupon.id)
  }, 30_000)

  it("allows a non-author couple member to redeem a coupon", async () => {
    const userA = await createUser(`coupon-a-${crypto.randomUUID()}@example.test`)
    const userB = await createUser(`coupon-b-${crypto.randomUUID()}@example.test`)
    const clientA = anon()
    const clientB = anon()
    await clientA.auth.signInWithPassword({ email: userA.email!, password })
    await clientB.auth.signInWithPassword({ email: userB.email!, password })
    const couple = await createCoupleWithClient(clientA)
    await joinCoupleWithClient(clientB, couple.coupleId, {
      coupleId: couple.coupleId, publicKey: btoa("recipient"),
      signingPublicKey: btoa("recipient-signing"), pairingNonce: btoa("nonce"),
    })
    await db.outbox.clear()
    await db.localRecords.clear()
    const coupon: CouponRecord = {
      id: crypto.randomUUID(), authorId: userA.id, createdAt: Date.now(),
      kind: "coupon", title: "Dinner", description: "Dinner", redeemed: false,
    }
    await createRecord(couple.coupleId, userA.id, coupon)
    await processOutbox(clientA)
    await expect(toggleCouponRedeemed(coupon.id, clientB)).resolves.toBeUndefined()
  }, 30_000)
})
