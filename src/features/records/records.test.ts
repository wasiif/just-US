import { describe, expect, it, vi } from "vitest"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(9)),
}))

import { decryptRecord, encryptRecord, RecordDecryptionError } from "./crypto"
import type { DecryptedRecord } from "./types"

const records: DecryptedRecord[] = [
  { id: "mood-1", authorId: "a", createdAt: 1, kind: "mood", emoji: "🙂", label: "Good" },
  { id: "coupon-1", authorId: "a", createdAt: 3, kind: "coupon", title: "Dinner", description: "One dinner", redeemed: false },
  { id: "milestone-1", authorId: "a", createdAt: 4, kind: "milestone", title: "First trip", date: "2026-10-01" },
  { id: "gratitude-1", authorId: "a", createdAt: 5, kind: "gratitude", text: "Thank you" },
]

describe("encrypted records", () => {
  it.each(records)("round-trips the $kind record", async (record) => {
    const envelope = await encryptRecord(record, "couple", record.id)
    await expect(decryptRecord(envelope, "couple", record.id, record.authorId, record.kind))
      .resolves.toEqual(record)
  })

  it("rejects tampered ciphertext", async () => {
    const envelope = await encryptRecord(records[0], "couple", records[0].id)
    envelope.ciphertext[0] ^= 1
    await expect(decryptRecord(envelope, "couple", records[0].id, records[0].authorId, records[0].kind))
      .rejects.toBeInstanceOf(RecordDecryptionError)
  })

  it("rejects an AAD built with the wrong record id", async () => {
    const record = records[1]
    const envelope = await encryptRecord(record, "couple", record.id)
    await expect(decryptRecord(envelope, "couple", "wrong-id", record.authorId, record.kind))
      .rejects.toBeInstanceOf(RecordDecryptionError)
  })
})
