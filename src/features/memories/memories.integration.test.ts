import { beforeAll, describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"
import { createClient } from "@supabase/supabase-js"
import sodium from "libsodium-wrappers-sumo"

vi.mock("../../core/keystore", () => ({ getCDK: vi.fn() }))

import { db } from "../../core/data"
import { createCoupleWithClient, joinCoupleWithClient } from "../pairing/coupleSetup"
import { decryptMediaFile } from "./crypto"
import { getGalleryItems, getStories, openFullImage, subscribeToGallery, uploadGalleryItem } from "./repository"
import { getCDK } from "../../core/keystore"

const env = typeof process === "undefined" ? {} : process.env
const enabled = env.RUN_SUPABASE_INTEGRATION === "1"
const url = env.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const password = env.SUPABASE_TEST_PASSWORD ?? `Memories-${crypto.randomUUID()}!`

function anon() {
  return createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function createUser(email: string) {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
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
      const result = request.method === "generateIdentityKeyPair"
        ? sodium.crypto_box_keypair()
        : request.method === "sealToRecipient"
          ? sodium.crypto_box_seal(request.args[0] as Uint8Array, request.args[1] as Uint8Array)
          : undefined
      queueMicrotask(() => this.listeners.forEach((listener) => listener({ data: { id: request.id, result } } as MessageEvent)))
    }
  })
})

describe.skipIf(!enabled)("memories Supabase integration", () => {
  it("proves member storage/realtime/decryption and outsider boundaries", async () => {
    if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
    const emailA = `memories-a-${crypto.randomUUID()}@example.test`
    const emailB = `memories-b-${crypto.randomUUID()}@example.test`
    const emailC = `memories-c-${crypto.randomUUID()}@example.test`
    const [userA] = await Promise.all([createUser(emailA), createUser(emailB), createUser(emailC)])
    const clientA = anon()
    const clientB = anon()
    const clientC = anon()
    await clientA.auth.signInWithPassword({ email: emailA, password })
    await clientB.auth.signInWithPassword({ email: emailB, password })
    await clientC.auth.signInWithPassword({ email: emailC, password })
    const couple = await createCoupleWithClient(clientA)
    await joinCoupleWithClient(clientB, couple.coupleId, {
      coupleId: couple.coupleId, publicKey: "", signingPublicKey: "", pairingNonce: "",
    })
    vi.mocked(getCDK).mockResolvedValue(couple.cdk)

    const processedFull = new Uint8Array([0x52, 0x45, 0x41, 0x4c, 0x2d, 0x46, 0x55, 0x4c, 0x4c])
    const processedThumb = new Uint8Array([0x52, 0x45, 0x41, 0x4c, 0x2d, 0x54, 0x48, 0x55, 0x4d, 0x42])
    let exportCount = 0
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4, height: 2, close: vi.fn() }))
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (callback: (blob: Blob) => void) => {
          exportCount += 1
          callback(new Blob([exportCount === 1 ? processedFull : processedThumb], { type: "image/webp" }))
        },
      }),
    })

    let resolveSubscribed: (() => void) | undefined
    let rejectSubscribed: ((error: Error) => void) | undefined
    const subscribed = new Promise<void>((resolve, reject) => {
      resolveSubscribed = resolve
      rejectSubscribed = reject
      setTimeout(() => reject(new Error("media_assets subscription timeout")), 15000)
    })
    const realtimeItem = new Promise<{ id: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("media_assets realtime timeout")), 15000)
      subscribeToGallery(couple.coupleId, (item) => {
        clearTimeout(timer)
        resolve(item)
      }, clientB, (status) => {
        if (status === "SUBSCRIBED") resolveSubscribed?.()
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") rejectSubscribed?.(new Error(`media_assets subscription ${status}`))
      })
    })
    await subscribed
    const assetId = await uploadGalleryItem(
      couple.coupleId,
      userA.id,
      new File(["original-with-gps-removed"], "photo.jpg", { type: "image/jpeg" }),
      undefined,
      clientA,
    )
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/)
    const { data: row, error: rowError } = await clientB.from("media_assets").select("*").eq("id", assetId).single()
    expect(rowError).toBeNull()
    expect(row.storage_path).toBe(`${couple.coupleId}/${assetId}.enc`)
    expect(row.thumb_path).toBe(`${couple.coupleId}/${assetId}.thumb.enc`)
    expect((await realtimeItem).id).toBe(assetId)

    const fullDownload = await clientB.storage.from("media").download(row.storage_path)
    expect(fullDownload.error).toBeNull()
    if (!fullDownload.data) throw new Error("Member full-media download returned no data")
    const fullBlob = await decryptMediaFile(new Uint8Array(await fullDownload.data.arrayBuffer()), couple.coupleId, assetId, userA.id, "image/webp")
    expect(new Uint8Array(await fullBlob.arrayBuffer())).toEqual(processedFull)
    const thumbDownload = await clientB.storage.from("media").download(row.thumb_path)
    expect(thumbDownload.error).toBeNull()
    if (!thumbDownload.data) throw new Error("Member thumbnail download returned no data")
    const thumbBlob = await decryptMediaFile(new Uint8Array(await thumbDownload.data.arrayBuffer()), couple.coupleId, `${assetId}.thumb`, userA.id, "image/webp")
    expect(new Uint8Array(await thumbBlob.arrayBuffer())).toEqual(processedThumb)
    expect(await getGalleryItems(couple.coupleId, 10, undefined, clientB)).toHaveLength(1)
    expect(await openFullImage(assetId, clientB)).toMatch(/^blob:/)

    const outsiderDownload = await clientC.storage.from("media").download(row.storage_path)
    expect(outsiderDownload.data).toBeNull()
    expect(outsiderDownload.error).toBeTruthy()
    const { data: outsiderRows, error: outsiderRowsError } = await clientC.from("media_assets").select("*").eq("id", assetId)
    expect(outsiderRowsError).toBeNull()
    expect(outsiderRows).toHaveLength(0)

    const admin = createClient(url, serviceKey)
    const expiredId = crypto.randomUUID()
    const { error: expiredError } = await admin.from("stories").insert({
      id: expiredId, couple_id: couple.coupleId, sender_id: userA.id,
      storage_path: `${couple.coupleId}/stories/${expiredId}.enc`,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    expect(expiredError).toBeNull()
    await db.localMediaAssets.put({
      id: expiredId, coupleId: couple.coupleId, senderId: userA.id, kind: "photo",
      createdAt: Date.now(), storagePath: `${couple.coupleId}/stories/${expiredId}.enc`,
      expiresAt: Date.now() - 60_000,
    })
    expect((await getStories(couple.coupleId, clientB)).some((story) => story.id === expiredId)).toBe(false)
  }, 60000)
})
