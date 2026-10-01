import { useCallback, useEffect, useState } from "react"
import {
  getLocalMessages,
  sendMessage as repositorySendMessage,
  subscribeToMessages,
} from "./repository"
import { db, retryFailed, startOutboxProcessing } from "../../core/data"
import type { DecryptedMessage } from "./types"

export function useChat(coupleId: string, senderId: string) {
  const [messages, setMessages] = useState<DecryptedMessage[]>([])
  const refresh = useCallback(async () => {
    setMessages(await getLocalMessages(coupleId, 200))
  }, [coupleId])

  useEffect(() => {
    void refresh()
    const unsubscribe = subscribeToMessages(coupleId, (message) => {
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message]
        .sort((a, b) => a.sentAt - b.sentAt))
    })
    const stopOutbox = startOutboxProcessing()
    return () => {
      unsubscribe()
      stopOutbox()
    }
  }, [coupleId, refresh])

  const send = useCallback(async (body: string) => {
    await repositorySendMessage(coupleId, senderId, body)
    await refresh()
  }, [coupleId, refresh, senderId])

  const retry = useCallback(async (localId: string) => {
    await retryFailed(localId)
    await refresh()
  }, [refresh])

  void db
  return { messages, send, retryFailed: retry }
}
