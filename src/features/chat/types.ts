export interface DecryptedMessage {
  id: string
  senderId: string
  body: string
  sentAt: number
  status: "sending" | "sent" | "delivered" | "read" | "failed"
  expiresAt?: number
}
