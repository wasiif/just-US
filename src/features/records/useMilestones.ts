import { useCallback, useEffect, useState } from "react"
import { createRecord, getLocalRecords, subscribeToRecords } from "./repository"
import type { MilestoneRecord } from "./types"

export function useMilestones(coupleId: string, authorId: string) {
  const [records, setRecords] = useState<MilestoneRecord[]>([])
  const refresh = useCallback(async () => setRecords(await getLocalRecords(coupleId, "milestone") as MilestoneRecord[]), [coupleId])
  useEffect(() => {
    void refresh()
    return subscribeToRecords(coupleId, "milestone", (record) =>
      setRecords((current) => [...current.filter((item) => item.id !== record.id), record as MilestoneRecord]))
  }, [coupleId, refresh])
  return { records, create: (record: MilestoneRecord) => createRecord(coupleId, authorId, record) }
}
