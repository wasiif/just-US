import { useCallback, useEffect, useState } from "react"
import { createRecord, getLocalRecords, subscribeToRecords } from "./repository"
import type { MoodRecord } from "./types"

export function useMood(coupleId: string, authorId: string) {
  const [records, setRecords] = useState<MoodRecord[]>([])
  const refresh = useCallback(async () => {
    setRecords(await getLocalRecords(coupleId, "mood") as MoodRecord[])
  }, [coupleId])
  useEffect(() => {
    void refresh()
    const stop = subscribeToRecords(coupleId, "mood", (record) => {
      setRecords((current) => [...current.filter((item) => item.id !== record.id), record as MoodRecord])
    })
    return stop
  }, [coupleId, refresh])
  const save = useCallback((record: MoodRecord) => createRecord(coupleId, authorId, record), [authorId, coupleId])
  return { records, save }
}
