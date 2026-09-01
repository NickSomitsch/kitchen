import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useAuth } from '../auth/AuthContext'
import type { ConnectionState, OfflineOperation } from '../types/database'
import { applyConflictDraft, retryOperation, syncPendingOperations } from './sync'
import { listOperations, offlineEvents, removeOperation } from './store'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface OfflineContextValue {
  connectionState: ConnectionState
  operations: OfflineOperation[]
  pendingCount: number
  attentionCount: number
  synchronize: () => Promise<void>
  retry: (operation: OfflineOperation) => Promise<void>
  discard: (operation: OfflineOperation) => Promise<void>
  applyDraft: (operation: OfflineOperation) => Promise<void>
  canInstall: boolean
  install: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextValue | null>(null)

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const { session, user } = useAuth()
  const queryClient = useQueryClient()
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [operations, setOperations] = useState<OfflineOperation[]>([])
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosInstall, setShowIosInstall] = useState(false)
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = typeof window !== 'undefined'
    && (window.matchMedia('(display-mode: standalone)').matches
      || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)))

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })

  const refreshOperations = useCallback(async () => {
    setOperations(user ? await listOperations(user.id) : [])
  }, [user])

  const synchronize = useCallback(async () => {
    if (!user || !session || !navigator.onLine) return
    setSyncing(true)
    try {
      await syncPendingOperations(user.id)
      await queryClient.invalidateQueries()
      await refreshOperations()
    } finally {
      setSyncing(false)
    }
  }, [queryClient, refreshOperations, session, user])

  useEffect(() => {
    const updateOnline = () => {
      setOnline(navigator.onLine)
      if (navigator.onLine) void synchronize()
    }
    const updateOperations = () => void refreshOperations()
    const updateProjection = () => void queryClient.invalidateQueries()
    const requestSync = () => void synchronize()
    const resume = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void synchronize()
    }
    const captureInstall = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('beforeinstallprompt', captureInstall)
    document.addEventListener('visibilitychange', resume)
    offlineEvents.addEventListener('change', updateOperations)
    offlineEvents.addEventListener('projection-change', updateProjection)
    offlineEvents.addEventListener('sync-request', requestSync)
    const initialRefresh = window.setTimeout(() => {
      void refreshOperations()
      if (navigator.onLine) void synchronize()
    }, 0)
    return () => {
      window.clearTimeout(initialRefresh)
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('beforeinstallprompt', captureInstall)
      document.removeEventListener('visibilitychange', resume)
      offlineEvents.removeEventListener('change', updateOperations)
      offlineEvents.removeEventListener('projection-change', updateProjection)
      offlineEvents.removeEventListener('sync-request', requestSync)
    }
  }, [queryClient, refreshOperations, synchronize])

  const authenticationRequired = Boolean(user && !session && online)
  const attentionCount = operations.filter((operation) => operation.status === 'conflict' || operation.status === 'failed').length
    + (authenticationRequired ? 1 : 0)
  const pendingCount = operations.filter((operation) => operation.status === 'pending' || operation.status === 'syncing').length
  const connectionState: ConnectionState = !online
    ? 'offline'
    : attentionCount
      ? 'needs-attention'
      : syncing || operations.some((operation) => operation.status === 'syncing')
        ? 'syncing'
        : 'online'

  useEffect(() => {
    if (!user || !pendingCount || attentionCount) return
    const retryTimer = window.setInterval(() => {
      void synchronize()
    }, 3_000)
    return () => window.clearInterval(retryTimer)
  }, [attentionCount, pendingCount, synchronize, user])

  const value = useMemo<OfflineContextValue>(() => ({
    connectionState,
    operations,
    pendingCount,
    attentionCount,
    synchronize,
    retry: async (operation) => {
      await retryOperation(operation)
      await refreshOperations()
    },
    discard: async (operation) => {
      await removeOperation(operation.id)
      await queryClient.invalidateQueries()
      await refreshOperations()
    },
    applyDraft: async (operation) => {
      await applyConflictDraft(operation)
      await queryClient.invalidateQueries()
      await refreshOperations()
    },
    canInstall: !isStandalone && (Boolean(installEvent) || isIos),
    install: async () => {
      if (installEvent) {
        await installEvent.prompt()
        await installEvent.userChoice
        setInstallEvent(null)
      } else if (isIos) {
        setShowIosInstall(true)
      }
    },
  }), [
    attentionCount,
    connectionState,
    installEvent,
    isIos,
    isStandalone,
    operations,
    pendingCount,
    queryClient,
    refreshOperations,
    synchronize,
  ])

  return (
    <OfflineContext.Provider value={value}>
      {children}
      {needRefresh ? (
        <div className="pwa-toast" role="status">
          <div><strong>Kitchen has an update</strong><span>Reload to use the latest version.</span></div>
          <button onClick={() => void updateServiceWorker(true)}>Update now</button>
          <button className="pwa-toast-close" onClick={() => setNeedRefresh(false)} aria-label="Dismiss update">×</button>
        </div>
      ) : null}
      {showIosInstall ? (
        <div className="pwa-toast" role="status">
          <div><strong>Install Kitchen</strong><span>Open Share, then choose “Add to Home Screen.”</span></div>
          <button onClick={() => setShowIosInstall(false)}>Got it</button>
        </div>
      ) : null}
    </OfflineContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOffline() {
  const context = useContext(OfflineContext)
  if (!context) throw new Error('useOffline must be used inside OfflineProvider.')
  return context
}
