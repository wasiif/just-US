import { useState } from "react"
import { useMood } from "./useMood"

export function MoodPicker({ coupleId, authorId }: { coupleId: string; authorId: string }) {
  const { records, save } = useMood(coupleId, authorId)
  const [label, setLabel] = useState("")
  return <main><h1>Mood</h1><input value={label} onChange={(event) => setLabel(event.target.value)} />
    <button type="button" onClick={() => void save({ id: crypto.randomUUID(), authorId, createdAt: Date.now(), kind: "mood", emoji: "🙂", label })}>Save</button>
    {records.map((record) => <p key={record.id}>{record.emoji} {record.label}</p>)}</main>
}
