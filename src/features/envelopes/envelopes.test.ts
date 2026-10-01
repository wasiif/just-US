import { describe, expect, it, vi } from "vitest"
import "fake-indexeddb/auto"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(5)),
}))

import { decryptEnvelopePayload, encryptEnvelopePayload, EnvelopeDecryptionError } from "./crypto"
import { checkMoodLock, checkPlaceLock } from "./repository"
import type { EnvelopeStub } from "./types"

const placeStub: EnvelopeStub = {
  id: "place-1",
  coupleId: "couple",
  senderId: "sender",
  lockType: "place",
  unlockPlace: { lat: 0, lng: 0, radiusM: 100 },
  isUnlocked: false,
  createdAt: Date.now(),
}

describe("sealed envelopes", () => {
  it("round-trips and rejects tampering", async () => {
    const envelope = await encryptEnvelopePayload("secret letter", "couple", "envelope", "sender")
    await expect(decryptEnvelopePayload(envelope, "couple", "envelope", "sender"))
      .resolves.toBe("secret letter")
    envelope.ciphertext[0] ^= 1
    await expect(decryptEnvelopePayload(envelope, "couple", "envelope", "sender"))
      .rejects.toBeInstanceOf(EnvelopeDecryptionError)
  })

  it("checks just inside and just outside the geofence radius", () => {
    expect(checkPlaceLock(placeStub, { lat: 0, lng: 0.0008 })).toBe(true)
    expect(checkPlaceLock(placeStub, { lat: 0, lng: 0.0011 })).toBe(false)
  })

  it("requires an exact mood match", () => {
    const stub = { ...placeStub, lockType: "mood" as const, unlockMood: "happy" }
    expect(checkMoodLock(stub, "happy")).toBe(true)
    expect(checkMoodLock(stub, "Happy")).toBe(false)
  })
})
