import { useCallback, useEffect, useState } from "react"
import { createRecord, getLocalRecords, subscribeToRecords, toggleCouponRedeemed } from "./repository"
import type { CouponRecord } from "./types"

export function useCoupons(coupleId: string, authorId: string) {
  const [records, setRecords] = useState<CouponRecord[]>([])
  const refresh = useCallback(async () => setRecords(await getLocalRecords(coupleId, "coupon") as CouponRecord[]), [coupleId])
  useEffect(() => {
    void refresh()
    return subscribeToRecords(coupleId, "coupon", (record) =>
      setRecords((current) => [...current.filter((item) => item.id !== record.id), record as CouponRecord]))
  }, [coupleId, refresh])
  return {
    records,
    create: (record: CouponRecord) => createRecord(coupleId, authorId, record),
    redeem: toggleCouponRedeemed,
  }
}
