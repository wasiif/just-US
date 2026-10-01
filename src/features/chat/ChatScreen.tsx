import { useState } from "react"
import { useChat } from "./useChat"

export function ChatScreen({ coupleId, senderId }: { coupleId: string; senderId: string }) {
  const chat = useChat(coupleId, senderId)
  const [text, setText] = useState("")
  return (
    <main>
      <section aria-label="Messages">
        {chat.messages.map((message) => (
          <article key={message.id}>
            <p>{message.body}</p>
            <small>{message.status}</small>
            {message.status === "failed" && (
              <button type="button" onClick={() => void chat.retryFailed(message.id)}>
                Failed to send, tap to retry
              </button>
            )}
          </article>
        ))}
      </section>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (!text.trim()) return
        void chat.send(text).then(() => setText(""))
      }}>
        <input value={text} onChange={(event) => setText(event.target.value)} />
        <button type="submit">Send</button>
      </form>
    </main>
  )
}
