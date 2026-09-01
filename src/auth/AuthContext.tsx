import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setOfflineAccessToken, setOfflineUserId } from '../offline/cache'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  forgetCachedUser: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
const OFFLINE_USER_KEY = 'kitchen-offline-user-v1'

function readCachedUser() {
  const value = localStorage.getItem(OFFLINE_USER_KEY)
  if (!value) return null
  try {
    return JSON.parse(value) as User
  } catch {
    localStorage.removeItem(OFFLINE_USER_KEY)
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const forgetCachedUser = useCallback(() => {
    localStorage.removeItem(OFFLINE_USER_KEY)
    setOfflineUserId(null)
    setOfflineAccessToken(null)
    setSession(null)
    setUser(null)
  }, [])

  useEffect(() => {
    let mounted = true
    let offlineBootstrap: number | undefined
    const cachedUser = readCachedUser()
    const hasCachedUser = Boolean(cachedUser)
    if (cachedUser) {
      offlineBootstrap = window.setTimeout(() => {
        if (!mounted) return
        setOfflineUserId(cachedUser.id)
        setUser(cachedUser)
        if (!navigator.onLine) setLoading(false)
      }, 0)
    }
    if (navigator.onLine) {
      void supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return
        const nextUser = data.session?.user ?? readCachedUser()
        setOfflineUserId(nextUser?.id ?? null)
        setOfflineAccessToken(data.session?.access_token ?? null)
        setSession(data.session)
        setUser(nextUser)
        if (data.session?.user) localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(data.session.user))
        setLoading(false)
      })
    } else if (!hasCachedUser) {
      offlineBootstrap = window.setTimeout(() => {
        if (mounted) setLoading(false)
      }, 0)
    }

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      const nextUser = nextSession?.user ?? readCachedUser()
      setOfflineUserId(nextUser?.id ?? null)
      setOfflineAccessToken(nextSession?.access_token ?? null)
      setSession(nextSession)
      setUser(nextUser)
      if (nextSession?.user) localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(nextSession.user))
      setLoading(false)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => {
      mounted = false
      if (offlineBootstrap !== undefined) window.clearTimeout(offlineBootstrap)
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      passwordRecovery,
      clearPasswordRecovery: () => setPasswordRecovery(false),
      forgetCachedUser,
    }),
    [session, user, loading, passwordRecovery, forgetCachedUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// This hook intentionally shares the provider module so their context cannot diverge.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider.')
  return value
}
