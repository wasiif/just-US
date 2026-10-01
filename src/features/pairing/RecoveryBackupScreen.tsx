import { useEffect, useMemo, useRef, useState } from "react"
import { generatePhrase, uploadKeyBackup, deriveAndWrapCDK, verifyPhraseConfirmation } from "./recoveryBackup"

interface RecoveryBackupScreenProps {
  coupleId: string
  cdk: Uint8Array
  initialPhrase?: string
  backupAlreadyUploaded?: boolean
  onComplete: () => void
}

export function RecoveryBackupScreen({
  coupleId,
  cdk,
  initialPhrase,
  backupAlreadyUploaded = false,
  onComplete,
}: RecoveryBackupScreenProps) {
  const [phrase, setPhrase] = useState<string | undefined>(initialPhrase)
  const [loading, setLoading] = useState(!initialPhrase || !backupAlreadyUploaded)
  const [answers, setAnswers] = useState<string[]>(["", "", ""])
  const [error, setError] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const indices = useMemo(() => {
    const values = new Set<number>()
    while (values.size < 3) values.add(Math.floor(Math.random() * 24))
    return [...values]
  }, [])

  useEffect(() => {
    if (initialPhrase && backupAlreadyUploaded) return
    void generatePhrase().then(async (value) => {
      setPhrase(value)
      const wrapped = await deriveAndWrapCDK(value, cdk)
      await uploadKeyBackup(coupleId, wrapped)
      setLoading(false)
    }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "Recovery backup failed")
      setLoading(false)
    })
  }, [backupAlreadyUploaded, cdk, coupleId, initialPhrase])

  function downloadText() {
    if (!phrase) return
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([phrase], { type: "text/plain" }))
    link.download = "just-us-recovery-phrase.txt"
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function downloadImage() {
    if (!phrase || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = 900
    canvas.height = 500
    const context = canvas.getContext("2d")
    if (!context) return
    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = "black"
    context.font = "24px sans-serif"
    phrase.split(" ").forEach((word, index) => {
      const x = 40 + (index % 4) * 215
      const y = 60 + Math.floor(index / 4) * 65
      context.fillText(`${index + 1}. ${word}`, x, y)
    })
    const link = document.createElement("a")
    link.href = canvas.toDataURL("image/png")
    link.download = "just-us-recovery-phrase.png"
    link.click()
  }

  function confirm() {
    if (!phrase) return
    const result = verifyPhraseConfirmation(phrase, answers, indices)
    if (result.every((entry) => entry.matched)) onComplete()
    else setError("One or more recovery words did not match")
  }

  if (loading) return <p>Preparing recovery backup…</p>
  if (error && !phrase) return <p role="alert">{error}</p>
  return (
    <section>
      <h2>Save your recovery phrase</h2>
      <p>{phrase}</p>
      <button type="button" onClick={downloadText}>Download as text file</button>
      <button type="button" onClick={downloadImage}>Download as image</button>
      <canvas ref={canvasRef} hidden />
      <h3>Confirm three words</h3>
      {indices.map((index, position) => (
        <label key={index}>
          Word {index + 1}
          <input
            value={answers[position]}
            onChange={(event) => setAnswers((current) => {
              const next = [...current]
              next[position] = event.target.value
              return next
            })}
          />
        </label>
      ))}
      <button type="button" onClick={confirm}>Continue</button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
