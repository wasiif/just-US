import { useEffect, useState } from "react"
import { AppRouter } from "./router"
import { PairingScreen } from "../features/pairing"
import { AuthScreen } from "./AuthScreen"
import { supabase } from "../core/network/supabaseClient"
import {
  authenticateAndGetCDK,
  getAuthenticationProof,
  hasTier0Key,
  isValidAuthenticationProof,
  KeystoreLock,
} from "../core/keystore"

const lock = new KeystoreLock()

export function LockGate() {
  const [hasKey, setHasKey] = useState<boolean>()
  const [unlocked, setUnlocked] = useState(false)
  const [error, setError] = useState<string>()
  const [authenticated, setAuthenticated] = useState<boolean>()

  useEffect(() => {
    let active = true
    const refresh = () => void hasTier0Key().then((value) => {
      if (active) setHasKey(value)
    })
    refresh()
    const interval = window.setInterval(refresh, 500)
    const stop = lock.startAutoLockTimer({ autoLockMinutes: 5 }, () => setUnlocked(false))
    return () => {
      active = false
      window.clearInterval(interval)
      stop()
    }
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthenticated(Boolean(data.session))
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAuthenticated(Boolean(session))
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (hasKey && isValidAuthenticationProof(getAuthenticationProof())) {
      lock.unlock(getAuthenticationProof())
      setUnlocked(true)
    }
  }, [hasKey])

  if (hasKey === undefined || authenticated === undefined) return <p>Loading secure device…</p>
  if (!authenticated) return <AuthScreen onAuthenticated={() => setAuthenticated(true)} />
  if (!hasKey) return <PairingScreen />
  if (!unlocked) return <main><h1>Unlock just-US</h1><button type="button" onClick={() => {
    setError(undefined)
    void authenticateAndGetCDK().then(() => {
      const proof = getAuthenticationProof()
      if (!isValidAuthenticationProof(proof)) throw new Error("Unlock proof was not accepted")
      lock.unlock(proof)
      setUnlocked(true)
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to unlock"))
  }}>Unlock</button>{error && <p role="alert">{error}</p>}</main>
  return <AppRouter />
}
