import { describe, expect, it } from "vitest"
import { decodePairingPayload, encodePairingPayload, PairingError } from "./qr"
import { computeSafetyNumber } from "./safetyNumber"

const payload = {
  coupleId: "00000000-0000-0000-0000-000000000001",
  publicKey: btoa("identity-public-key"),
  signingPublicKey: btoa("signing-public-key"),
  pairingNonce: btoa("nonce"),
}

describe("pairing QR payloads", () => {
  it("encodes and decodes a payload", () => {
    expect(decodePairingPayload(encodePairingPayload(payload))).toEqual(payload)
  })

  it("rejects malformed or incomplete untrusted input", () => {
    expect(() => decodePairingPayload("not-base64")).toThrow(PairingError)
    const malformed = btoa(JSON.stringify({ publicKey: payload.publicKey }))
    expect(() => decodePairingPayload(malformed)).toThrow(PairingError)
  })
})

describe("safety numbers", () => {
  it("is deterministic and independent of key order", async () => {
    const first = Uint8Array.from({ length: 32 }, (_, index) => index)
    const second = Uint8Array.from({ length: 32 }, (_, index) => 255 - index)
    const leftToRight = await computeSafetyNumber(first, second)
    const rightToLeft = await computeSafetyNumber(second, first)
    expect(leftToRight).toBe(rightToLeft)
    expect(leftToRight).toMatch(/^\d{4}( \d{4}){3}$/)
  })
})
