import Dexie, { type Table } from "dexie"

export type OutboxStatus = "pending" | "sent" | "failed"

export interface OutboxRow {
  localId: string
  table: string
  payload: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  createdAt: number
}

export interface SyncCursorRow {
  table: string
  lastServerSeq: number
}

export interface LocalMessageRow {
  id: string
  coupleId: string
  senderId: string
  body?: string
  sentAt: number
  status: "sending" | "sent" | "delivered" | "read" | "failed"
  expiresAt?: number
  envelope?: {
    version: number
    keyVersion: number
    nonce: Uint8Array
    ciphertext: Uint8Array
  }
}

export interface LocalRecordRow {
  id: string
  coupleId: string
  authorId: string
  kind: string
  createdAt: number
  record?: Record<string, unknown>
  status: "pending" | "sent" | "failed"
}

export interface LocalEnvelopeStubRow {
  id: string
  coupleId: string
  senderId: string
  hint?: string
  lockType: string
  unlockAt?: number
  unlockPlace?: { lat: number; lng: number; radiusM: number }
  unlockMood?: string
  isUnlocked: boolean
  openedAt?: number
  createdAt: number
}

export interface LocalMediaAssetRow {
  id: string
  coupleId: string
  senderId: string
  kind: string
  createdAt: number
  storagePath: string
  thumbPath?: string
  sizeBytes?: number
  thumbnailBlob?: Blob
  expiresAt?: number
}

export class JustUsDatabase extends Dexie {
  outbox!: Table<OutboxRow, string>
  syncCursors!: Table<SyncCursorRow, string>
  localMessages!: Table<LocalMessageRow, string>
  localRecords!: Table<LocalRecordRow, string>
  localEnvelopeStubs!: Table<LocalEnvelopeStubRow, string>
  localMediaAssets!: Table<LocalMediaAssetRow, string>

  constructor() {
    super("just-us")
    this.version(1).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
    })
    this.version(2).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
      localMessages: "id, coupleId, sentAt, status",
    })
    this.version(3).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
      localMessages: "id, coupleId, sentAt, status",
      localRecords: "id, coupleId, kind, createdAt",
    })
    this.version(4).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
      localMessages: "id, coupleId, sentAt, status",
      localRecords: "id, coupleId, kind, createdAt",
    })
    this.version(5).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
      localMessages: "id, coupleId, sentAt, status",
      localRecords: "id, coupleId, kind, createdAt",
      localEnvelopeStubs: "id, coupleId, lockType, createdAt",
    })
    this.version(6).stores({
      outbox: "localId, table, status, createdAt",
      syncCursors: "table",
      localMessages: "id, coupleId, sentAt, status",
      localRecords: "id, coupleId, kind, createdAt",
      localEnvelopeStubs: "id, coupleId, lockType, createdAt",
      localMediaAssets: "id, coupleId, kind, createdAt, expiresAt",
    })
  }
}

export const db = new JustUsDatabase()
