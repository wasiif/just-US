import { useState } from "react"
import { useDailyQuestion } from "./useDailyQuestion"

export function DailyQuestionScreen({ coupleId, authorId, questionId, promptDate }: { coupleId: string; authorId: string; questionId: string; promptDate: string }) {
  const { answers, submit } = useDailyQuestion(coupleId, authorId)
  const [answer, setAnswer] = useState("")
  const [waiting, setWaiting] = useState(false)
  return <main><h1>Daily question</h1><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} />
    <button type="button" onClick={() => { setWaiting(true); void submit({ questionId, answer, promptDate }).catch(() => undefined) }}>Submit answer</button>
    {waiting && <p>Waiting for them to answer</p>}
    {answers.map((record) => <p key={record.id}>{record.answer}</p>)}</main>
}
