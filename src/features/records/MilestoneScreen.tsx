import { useState } from "react"
import { useMilestones } from "./useMilestones"

export function MilestoneScreen({ coupleId, authorId }: { coupleId: string; authorId: string }) {
  const { records, create } = useMilestones(coupleId, authorId)
  const [title, setTitle] = useState("")
  return <main><h1>Milestones</h1><input value={title} onChange={(event) => setTitle(event.target.value)} />
    <button type="button" onClick={() => void create({ id: crypto.randomUUID(), authorId, createdAt: Date.now(), kind: "milestone", title, date: new Date().toISOString() })}>Add</button>
    {records.map((record) => <p key={record.id}>{record.title} — {record.date}</p>)}</main>
}
