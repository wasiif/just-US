import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../core/keystore", () => ({
  getCDK: vi.fn().mockResolvedValue(new Uint8Array(32).fill(7)),
}))

import { db, getOutboxRow, processOutbox } from "../../core/data"
import { getLocalMessages, sendMessage } from "./repository"

beforeEach(async () => {
  await db.outbox.clear()
  await db.localMessages.clear()
  await db.syncCursors.clear()
})

describe("offline-first chat", () => {
  it("renders an optimistic message, marks failure, then retries idempotently", async () => {
    const calls: Record<string, unknown>[] = []
    const client = {
      from: () => ({
        insert: async (payload: Record<string, unknown>) => {
          calls.push(payload)
          if (calls.length === 1) return { error: { code: "OFFLINE", message: "offline" } }
          return { error: null }
        },
      }),
    } as never

    const id = await sendMessage("couple", "sender", "hello")
    expect((await getLocalMessages("couple", 10))[0]).toMatchObject({
      id,
      body: "hello",
      status: "sending",
    })
    await processOutbox(client, 1)
    expect((await getLocalMessages("couple", 10))[0].status).toBe("failed")
    const failed = await getOutboxRow(id)
    expect(failed?.status).toBe("failed")

    await db.outbox.update(id, { status: "pending", attempts: 0 })
    await processOutbox(client, 1)
    expect((await getLocalMessages("couple", 10))[0].status).toBe("sent")
    await processOutbox(client, 1)
    expect(calls).toHaveLength(2)
  })
})
