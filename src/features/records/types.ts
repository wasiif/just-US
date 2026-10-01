export type RecordKind = "mood" | "coupon" | "milestone" | "gratitude"

export interface DecryptedRecordBase {
  id: string
  authorId: string
  createdAt: number
}

export interface MoodRecord extends DecryptedRecordBase {
  kind: "mood"
  emoji: string
  label: string
  note?: string
  expiresAt?: number
}

export interface DailyAnswer {
  id: string
  coupleId: string
  authorId: string
  questionId: string
  answer: string
  promptDate: string
  createdAt: number
}

export interface CouponRecord extends DecryptedRecordBase {
  kind: "coupon"
  title: string
  description: string
  redeemed: boolean
  redeemedAt?: number
}

export interface MilestoneRecord extends DecryptedRecordBase {
  kind: "milestone"
  title: string
  date: string
  note?: string
}

export interface GratitudeRecord extends DecryptedRecordBase {
  kind: "gratitude"
  text: string
}

export type DecryptedRecord =
  | MoodRecord
  | CouponRecord
  | MilestoneRecord
  | GratitudeRecord
