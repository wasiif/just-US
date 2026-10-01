import { useEffect, useState } from "react"
import { fetchPayload } from "./repository"
import type { DecryptedEnvelope } from "./types"

export function EnvelopeRevealScreen({ envelopeId, coupleId, senderId }: { envelopeId: string; coupleId: string; senderId: string }) {
  const [envelope, setEnvelope] = useState<DecryptedEnvelope>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    void fetchPayload(envelopeId, coupleId, senderId).then(setEnvelope).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Unable to open envelope")
    })
  }, [coupleId, envelopeId, senderId])
  if (error) return <main><p>{error}</p></main>
  return <main><h1>Open When</h1><p>{envelope?.body ?? "Opening..."}</p></main>
}
