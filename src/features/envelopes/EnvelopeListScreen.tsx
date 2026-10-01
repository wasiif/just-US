import { useEnvelopes } from "./useEnvelopes"

export function EnvelopeListScreen({ coupleId, senderId }: { coupleId: string; senderId: string }) {
  const { items, open } = useEnvelopes(coupleId, senderId)
  return <main>
    <h1>Open When</h1>
    {items.map(({ stub, displayState }) => <article key={stub.id}>
      <h2>{stub.hint || "Sealed envelope"}</h2>
      <p>{stub.lockType}</p>
      {(stub.lockType === "place" || stub.lockType === "mood") && (
        <p>This lock only checks while the app is open in the foreground and is not cryptographically enforced.</p>
      )}
      <small>{displayState}</small>
      {displayState === "unlockable" && <button type="button" onClick={() => void open(stub.id)}>Open</button>}
    </article>)}
  </main>
}
