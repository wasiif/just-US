import { useState } from "react"
import { useEnvelopes } from "./useEnvelopes"
import type { LockType } from "./types"

export function CreateEnvelopeScreen({ coupleId, senderId }: { coupleId: string; senderId: string }) {
  const { create } = useEnvelopes(coupleId, senderId)
  const [body, setBody] = useState("")
  const [hint, setHint] = useState("")
  const [lockType, setLockType] = useState<LockType>("manual")
  const [unlockAt, setUnlockAt] = useState("")
  const [unlockMood, setUnlockMood] = useState("")
  const [lat, setLat] = useState("")
  const [lng, setLng] = useState("")
  const [radiusM, setRadiusM] = useState("100")
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const foregroundNote = lockType === "place" || lockType === "mood"
  return <main>
    <h1>Create envelope</h1>
    <input aria-label="Hint" value={hint} onChange={(event) => setHint(event.target.value)} placeholder="Hint" />
    <textarea aria-label="Body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Letter" />
    <select value={lockType} onChange={(event) => setLockType(event.target.value as LockType)}>
      <option value="manual">Manual</option><option value="time">Time</option>
      <option value="place">Place</option><option value="mood">Mood</option>
    </select>
    {lockType === "time" && <input type="datetime-local" value={unlockAt} onChange={(event) => setUnlockAt(event.target.value)} />}
    {lockType === "mood" && <input aria-label="Mood" value={unlockMood} onChange={(event) => setUnlockMood(event.target.value)} placeholder="Mood" />}
    {lockType === "place" && <>
      <input aria-label="Latitude" value={lat} onChange={(event) => setLat(event.target.value)} placeholder="Latitude" />
      <input aria-label="Longitude" value={lng} onChange={(event) => setLng(event.target.value)} placeholder="Longitude" />
      <input aria-label="Radius" value={radiusM} onChange={(event) => setRadiusM(event.target.value)} placeholder="Radius in meters" />
    </>}
    {foregroundNote && <p>This lock only checks while the app is open in the foreground and is not cryptographically enforced.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={saving} onClick={() => {
      setSaving(true)
      setError(undefined)
      void create(body, lockType, {
      unlockAt: lockType === "time" ? new Date(unlockAt) : undefined,
      unlockMood: lockType === "mood" ? unlockMood : undefined,
      unlockPlace: lockType === "place" ? { lat: Number(lat), lng: Number(lng), radiusM: Number(radiusM) } : undefined,
      }, hint).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : "Envelope could not be saved")
      }).finally(() => setSaving(false))
    }}>Seal envelope</button>
  </main>
}
