import { useCallback, useEffect, useState } from "react"
import { getLocalDailyAnswers, submitDailyAnswer, subscribeToDailyAnswers } from "./dailyAnswers"
import type { DailyAnswer } from "./types"

export function useDailyQuestion(coupleId: string, authorId: string) {
  const [answers, setAnswers] = useState<DailyAnswer[]>([])
  const refresh = useCallback(async () => {
    setAnswers(await getLocalDailyAnswers(coupleId))
  }, [coupleId])
  useEffect(() => {
    void refresh()
    return subscribeToDailyAnswers(coupleId, (answer) =>
      setAnswers((current) => [...current.filter((item) => item.id !== answer.id), answer]))
  }, [coupleId, refresh])
  const submit = (answer: Omit<DailyAnswer, "id" | "coupleId" | "authorId" | "createdAt">) =>
    submitDailyAnswer({
      ...answer,
      id: crypto.randomUUID(),
      coupleId,
      authorId,
      createdAt: Date.now(),
    })
  return { answers, submit }
}
