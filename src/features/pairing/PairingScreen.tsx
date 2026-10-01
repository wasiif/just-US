import { useEffect, useState } from "react"
import QRCode from "qrcode"
import { usePairing } from "./usePairing"
import { RecoveryBackupScreen } from "./RecoveryBackupScreen"

export function PairingScreen() {
  const pairing = usePairing()
  const [code, setCode] = useState("")
  const [qrDataUrl, setQrDataUrl] = useState<string>()

  useEffect(() => {
    if (!pairing.encodedPayload) return
    void QRCode.toDataURL(pairing.encodedPayload).then(setQrDataUrl)
  }, [pairing.encodedPayload])

  return (
    <main>
      <h1>Pair your devices</h1>
      {pairing.state === "idle" && (
        <>
          <button type="button" onClick={() => void pairing.startPairing()}>Start pairing</button>
          <button type="button" onClick={() => setCode("")}>I have a code</button>
        </>
      )}
      {pairing.state === "showing-code" && pairing.encodedPayload && (
        <>
          {pairing.recoveryLoading && <p>Preparing encrypted recovery backup…</p>}
          {pairing.recoveryPhrase && pairing.cdk && pairing.pairingPayload && (
            <RecoveryBackupScreen
              coupleId={pairing.pairingPayload.coupleId}
              cdk={pairing.cdk}
              initialPhrase={pairing.recoveryPhrase}
              backupAlreadyUploaded
              onComplete={() => void pairing.completeWithCDK(pairing.cdk!)}
            />
          )}
          <p>Scan or paste this pairing code on the other device.</p>
          {qrDataUrl && <img src={qrDataUrl} alt="Pairing QR code" />}
          <code>{pairing.encodedPayload}</code>
        </>
      )}
      {pairing.state === "idle" && (
        <form onSubmit={(event) => {
          event.preventDefault()
          void pairing.submitCode(code)
        }}>
          <label>
            Pairing code
            <input value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <button type="submit">Continue</button>
        </form>
      )}
      {pairing.state === "verifying-safety-number" && (
        <>
          <p>Safety number: {pairing.safetyNumber}</p>
          <button type="button" onClick={() => pairing.confirmSafetyNumber(true)}>
            They match
          </button>
          <button type="button" onClick={() => pairing.confirmSafetyNumber(false)}>
            They don&apos;t match
          </button>
        </>
      )}
      {pairing.state === "error" && <p role="alert">{pairing.error?.message}</p>}
    </main>
  )
}
