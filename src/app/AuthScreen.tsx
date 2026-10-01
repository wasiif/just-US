import { useState } from "react"
import { supabase } from "../core/network/supabaseClient"

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in")
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setMessage(undefined)
    const result = mode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (result.error) {
      setMessage(result.error.message)
      return
    }
    if (mode === "sign-up" && !result.data.session) {
      setMessage("Account created. Check your email to confirm it, then sign in.")
      return
    }
    onAuthenticated()
  }

  return <main>
    <h1>{mode === "sign-in" ? "Sign in to just-US" : "Create a just-US account"}</h1>
    <form onSubmit={(event) => void submit(event)}>
      <label>Email <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}</button>
    </form>
    <button type="button" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(undefined) }}>
      {mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}
    </button>
    {message && <p role="alert">{message}</p>}
  </main>
}
