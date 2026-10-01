import { useState } from "react"
import { useCoupons } from "./useCoupons"

export function CouponScreen({ coupleId, authorId }: { coupleId: string; authorId: string }) {
  const { records, create, redeem } = useCoupons(coupleId, authorId)
  const [title, setTitle] = useState("")
  return <main><h1>Coupons</h1><input value={title} onChange={(event) => setTitle(event.target.value)} />
    <button type="button" onClick={() => void create({ id: crypto.randomUUID(), authorId, createdAt: Date.now(), kind: "coupon", title, description: "", redeemed: false })}>Create</button>
    {records.map((record) => <article key={record.id}><p>{record.title}</p><button type="button" disabled={record.redeemed} onClick={() => void redeem(record.id)}>Redeem</button></article>)}</main>
}
