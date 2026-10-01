import { useCallback, useState } from "react"
import {
  computeSafetyNumber,
} from "./safetyNumber"
import {
  createCouple,
  fetchWrappedCDK,
  joinCouple,
} from "./coupleSetup"
import {
  decodePairingPayload,
  encodePairingPayload,
  generatePairingPayload,
  PairingError,
} from "./qr"
import type { PairingPayload, PairingState } from "./types"
import {
  getCDK,
  hasAuthenticatorCredential,
  persistCDK,
  registerAuthenticator,
  persistCoupleId,
} from "../../core/keystore"
import { deriveAndWrapCDK, generatePhrase, uploadKeyBackup } from "./recoveryBackup"

export interface PairingController {
  state: PairingState
  encodedPayload?: string
  pairingPayload?: PairingPayload
  safetyNumber?: string
  error?: Error
  recoveryPhrase?: string
  cdk?: Uint8Array
  recoveryLoading: boolean
  completeWithCDK: (cdk: Uint8Array) => Promise<void>
  getCDK: typeof getCDK
  startPairing: () => Promise<void>
  submitCode: (raw: string) => Promise<void>
  confirmSafetyNumber: (matches: boolean) => void
}

export function usePairing(): PairingController {
  const [state, setState] = useState<PairingState>("idle")
  const [pairingPayload, setPairingPayload] = useState<PairingPayload>()
  const [encodedPayload, setEncodedPayload] = useState<string>()
  const [safetyNumber, setSafetyNumber] = useState<string>()
  const [error, setError] = useState<Error>()
  const [recoveryPhrase, setRecoveryPhrase] = useState<string>()
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [pendingCDK, setPendingCDK] = useState<Uint8Array>()

  const persistCompletedCDK = useCallback(async (cdk: Uint8Array) => {
    if (!(await hasAuthenticatorCredential())) {
      await registerAuthenticator("just-us-user", "just-US user")
    }
    await persistCDK(cdk)
  }, [])

  const startPairing = useCallback(async () => {
    try {
      setError(undefined)
      setState("generating")
      const couple = await createCouple()
      const pairing = await generatePairingPayload(couple.coupleId)
      setRecoveryLoading(true)
      const phrase = await generatePhrase()
      await uploadKeyBackup(couple.coupleId, await deriveAndWrapCDK(phrase, couple.cdk))
      setRecoveryPhrase(phrase)
      setPendingCDK(couple.cdk)
      setRecoveryLoading(false)
      const payload = pairing.payload
      setPairingPayload(payload)
      setEncodedPayload(encodePairingPayload(payload))
      console.log("Pairing CDK held in memory", couple.cdk)
      setState("showing-code")
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Pairing failed"))
      setRecoveryLoading(false)
      setState("error")
    }
  }, [])

  const submitCode = useCallback(async (raw: string) => {
    try {
      setError(undefined)
      setState("scanning")
      const incoming = decodePairingPayload(raw)
      setPairingPayload(incoming)
      setState("exchanging")
      const local = await generatePairingPayload()
      await joinCouple(incoming.coupleId, incoming)
      const cdk = await fetchWrappedCDK(incoming.coupleId, local.identityKeyPair)
      setPendingCDK(cdk)
      const number = await computeSafetyNumber(
        local.identityKeyPair.publicKey,
        incoming.publicKey,
      )
      setSafetyNumber(number)
      setState("verifying-safety-number")
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Pairing failed"))
      setState("error")
    }
  }, [])

  const completeWithCDK = useCallback(async (cdk: Uint8Array) => {
    try {
      if (!pairingPayload?.coupleId) throw new PairingError("Missing couple ID")
      await persistCompletedCDK(cdk)
      await persistCoupleId(pairingPayload.coupleId)
      setState("complete")
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("CDK persistence failed"))
      setState("error")
    }
  }, [pairingPayload, persistCompletedCDK])

  const confirmSafetyNumber = useCallback((matches: boolean) => {
    if (matches) {
      if (!pendingCDK) {
        setError(new PairingError("No exchanged CDK is available"))
        setState("error")
        return
      }
      void completeWithCDK(pendingCDK)
    }
    else {
      setError(new PairingError("Safety numbers do not match"))
      setState("error")
    }
  }, [completeWithCDK, pendingCDK])

  return {
    state,
    encodedPayload,
    pairingPayload,
    safetyNumber,
    error,
    recoveryPhrase,
    cdk: pendingCDK,
    recoveryLoading,
    completeWithCDK,
    getCDK,
    startPairing,
    submitCode,
    confirmSafetyNumber,
  }
}
