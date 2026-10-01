import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { getPersistedCoupleId } from "../core/keystore"
import { supabase } from "../core/network/supabaseClient"

interface SessionValue {
  coupleId?: string
  userId?: string
  loading: boolean
}

const SessionContext = createContext<SessionValue>({ loading: true })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<SessionValue>({ loading: true })
  useEffect(() => {
    let active = true
    const refresh = () => void Promise.all([
      getPersistedCoupleId(),
      supabase.auth.getUser(),
    ]).then(([coupleId, result]) => {
      if (active) setValue({ coupleId, userId: result.data.user?.id, loading: false })
    }).catch(() => {
      if (active) setValue({ loading: false })
    })
    refresh()
    const interval = window.setInterval(refresh, 500)
    return () => { active = false; window.clearInterval(interval) }
  }, [])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionValue {
  return useContext(SessionContext)
}
