export type LockType = "time" | "place" | "mood" | "manual"

export interface EnvelopeStub {
  id: string
  coupleId: string
  senderId: string
  hint?: string
  lockType: LockType
  unlockAt?: number
  unlockPlace?: { lat: number; lng: number; radiusM: number }
  unlockMood?: string
  isUnlocked: boolean
  openedAt?: number
  createdAt: number
}

export interface DecryptedEnvelope {
  id: string
  body: string
  createdAt: number
}
