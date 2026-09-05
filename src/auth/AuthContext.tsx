import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { setOfflineAccessToken, setOfflineUserId } from '../offline/cache'

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /**
   * The server was asked and answered that there is no session. The cached user is
   * still remembered so offline data keeps working, but they are not signed in.
   */
  signedOut: boolean
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  forgetCachedUser: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
const OFFLINE_USER_KEY = 'kitchen-offline-user-v1'
// Long enough for a slow phone connection, short enough that nobody is left staring
// at the loading screen when the call never comes back.
const AUTH_BOOTSTRAP_TIMEOUT = 8_000

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
  const [signedOut, setSignedOut] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const forgetCachedUser = useCallback(() => {
    localStorage.removeItem(OFFLINE_USER_KEY)
    setOfflineUserId(null)
    setOfflineAccessToken(null)
    setSession(null)
    setUser(null)
    setSignedOut(false)
  }, [])

  useEffect(() => {
    let mounted = true
    let offlineBootstrap: number | undefined
    let watchdog: number | undefined

    /**
     * `answered` records that the server actually told us the session state, which is
     * what separates a genuinely expired session from a request we could not make.
     * Only the former may sign someone out: treating a failed call as a sign-out
     * would strand people without their offline kitchen the moment a train tunnel
     * swallowed the request.
     */
    const applySession = (nextSession: Session | null, answered: boolean) => {
      if (!mounted) return
      const nextUser = nextSession?.user ?? readCachedUser()
      setOfflineUserId(nextUser?.id ?? null)
      setOfflineAccessToken(nextSession?.access_token ?? null)
      setSession(nextSession)
      setUser(nextUser)
      setSignedOut(answered && !nextSession)
      if (nextSession?.user) localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(nextSession.user))
      setLoading(false)
    }

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
      // getSession refreshes an expired token, so it can hang on a bad connection or
      // reject outright. Either way the boot has to end, or the app never renders
      // anything but the loading screen.
      watchdog = window.setTimeout(() => {
        if (mounted) setLoading(false)
      }, AUTH_BOOTSTRAP_TIMEOUT)
      void supabase.auth.getSession()
        .then(({ data }) => applySession(data.session, true))
        .catch(() => applySession(null, false))
        .finally(() => window.clearTimeout(watchdog))
    } else if (!hasCachedUser) {
      offlineBootstrap = window.setTimeout(() => {
        if (mounted) setLoading(false)
      }, 0)
    }

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // A null session here arrives with SIGNED_OUT or INITIAL_SESSION, both of which
      // follow the client checking its stored token rather than a failed request.
      applySession(nextSession, navigator.onLine)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })

    return () => {
      mounted = false
      if (offlineBootstrap !== undefined) window.clearTimeout(offlineBootstrap)
      if (watchdog !== undefined) window.clearTimeout(watchdog)
      data.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo(
    () => ({
      session,
      user,
      loading,
      signedOut,
      passwordRecovery,
      clearPasswordRecovery: () => setPasswordRecovery(false),
      forgetCachedUser,
    }),
    [session, user, loading, signedOut, passwordRecovery, forgetCachedUser],
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
