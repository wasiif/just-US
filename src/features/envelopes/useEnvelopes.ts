import { useCallback, useEffect, useMemo, useState } from "react"
import {
  checkMoodLock,
  checkPlaceLock,
  createEnvelope,
  getLocalStubs,
  openEnvelope,
  subscribeToEnvelopes,
  type EnvelopeLockParams,
  type PlacePosition,
} from "./repository"
import type { EnvelopeStub, LockType } from "./types"

export type EnvelopeDisplayState = "sealed" | "unlockable" | "opened"

export function useEnvelopes(
  coupleId: string,
  senderId: string,
  currentPosition?: PlacePosition,
  currentMood?: string,
) {
  const [stubs, setStubs] = useState<EnvelopeStub[]>([])
  const refresh = useCallback(async () => setStubs(await getLocalStubs(coupleId)), [coupleId])
  useEffect(() => {
    void refresh()
    const stop = subscribeToEnvelopes(coupleId, (stub) => {
      setStubs((current) => [...current.filter((item) => item.id !== stub.id), stub]
        .sort((a, b) => b.createdAt - a.createdAt))
    })
    const interval = window.setInterval(() => {
      for (const stub of stubs) {
        if (stub.isUnlocked) continue
        if ((stub.lockType === "place" && currentPosition && checkPlaceLock(stub, currentPosition))
          || (stub.lockType === "mood" && currentMood && checkMoodLock(stub, currentMood))
          || (stub.lockType === "time" && stub.unlockAt !== undefined && stub.unlockAt <= Date.now())) {
          void openEnvelope(stub.id).then(refresh)
        }
      }
    }, 30_000)
    return () => {
      stop()
      window.clearInterval(interval)
    }
  }, [coupleId, currentMood, currentPosition, refresh, stubs])

  const items = useMemo(() => stubs.map((stub) => ({
    stub,
    displayState: stub.isUnlocked
      ? "opened" as const
      : (stub.lockType === "time" && stub.unlockAt !== undefined && stub.unlockAt <= Date.now())
        || (stub.lockType === "place" && currentPosition && checkPlaceLock(stub, currentPosition))
        || (stub.lockType === "mood" && currentMood && checkMoodLock(stub, currentMood))
        ? "unlockable" as const
        : "sealed" as const,
  })), [currentMood, currentPosition, stubs])

  const create = useCallback((
    body: string,
    lockType: LockType,
    lockParams: EnvelopeLockParams,
    hint?: string,
  ) => createEnvelope(coupleId, senderId, body, lockType, lockParams, hint).then(refresh), [coupleId, refresh, senderId])

  return { stubs, items, create, open: (id: string) => openEnvelope(id).then(refresh), refresh }
}
