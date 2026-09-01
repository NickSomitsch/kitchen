import { AlertTriangle, Boxes, Cloud, Download, LogOut, RefreshCw, Settings, ShoppingCart, WifiOff } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchGroceries, queryKeys } from '../api/kitchen'
import { useHouseholdRealtime } from '../hooks/useHousehold'
import { supabase } from '../lib/supabase'
import { useOffline } from '../offline/OfflineContext'
import { clearOfflineUser } from '../offline/store'
import type { HouseholdContext, Json, OfflineOperation } from '../types/database'
import { Button, Modal } from './ui'

function operationLabel(operation: OfflineOperation) {
  const action = operation.kind.split('.')[1]
  const target = operation.entity_type === 'inventory' ? 'inventory item' : 'grocery item'
  return `${action.charAt(0).toUpperCase()}${action.slice(1)} ${target}`
}

function summary(value: Record<string, Json> | null) {
  if (!value) return 'This item was removed on the server.'
  const parts = [value.name, value.quantity, value.unit].filter((part) => part !== null && part !== undefined && part !== '')
  return parts.length ? parts.join(' ') : 'No preview is available.'
}

export function AppShell({
  context,
  children,
}: {
  context: HouseholdContext
  children: React.ReactNode
}) {
  const { session, user, forgetCachedUser } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const offline = useOffline()
  const [syncOpen, setSyncOpen] = useState(false)
  useHouseholdRealtime(context.household.id)
  const groceries = useQuery({
    queryKey: queryKeys.groceries(context.household.id),
    queryFn: () => fetchGroceries(context.household.id),
  })
  const activeGroceries = (groceries.data ?? []).filter((item) => item.status === 'active')
  const lowStockGroceries = activeGroceries.filter((item) => item.source === 'low_stock').length

  async function signOut() {
    if (offline.operations.length && !window.confirm(`Sign out and discard ${offline.operations.length} unsynchronized ${offline.operations.length === 1 ? 'change' : 'changes'}?`)) return
    if (navigator.onLine) {
      const { error } = await supabase.auth.signOut()
      if (error) await supabase.auth.signOut({ scope: 'local' })
    } else {
      await supabase.auth.signOut({ scope: 'local' })
    }
    if (user) await clearOfflineUser(user.id)
    forgetCachedUser()
    queryClient.clear()
    navigate('/auth', { replace: true })
  }

  function signInAgain() {
    forgetCachedUser()
    queryClient.clear()
    setSyncOpen(false)
    navigate('/auth', { replace: true })
  }

  const statusLabel = offline.connectionState === 'needs-attention'
    ? `${offline.attentionCount} need attention`
    : offline.connectionState === 'syncing'
      ? `Syncing ${offline.pendingCount}`
      : offline.connectionState === 'offline'
        ? `${offline.pendingCount ? `${offline.pendingCount} pending · ` : ''}Offline`
        : 'Online'

  return (
    <div className="app-frame">
      <header className="app-header">
        <NavLink to="/inventory" className="brand-link" aria-label="Kitchen inventory home">
          <div className="brand-mark"><span>K</span></div>
          <div className="brand-copy">
            <strong>Kitchen</strong>
            <span>{context.household.name}</span>
          </div>
        </NavLink>
        <nav className="main-nav" aria-label="Main navigation">
          <NavLink to="/inventory">
            <Boxes size={18} />
            <span>Inventory</span>
          </NavLink>
          <NavLink to="/grocery">
            <ShoppingCart size={18} />
            <span>Groceries</span>
            {activeGroceries.length ? <b className="nav-count">{activeGroceries.length}</b> : null}
            {lowStockGroceries ? <span className="sr-only">{lowStockGroceries} low-stock items</span> : null}
          </NavLink>
          <NavLink to="/settings">
            <Settings size={18} />
            <span>Settings</span>
          </NavLink>
        </nav>
        <div className="account-area">
          {offline.canInstall ? (
            <button className="header-install" onClick={() => void offline.install()} title="Install Kitchen">
              <Download size={17} /><span>Install</span>
            </button>
          ) : null}
          <button
            className={`connection-status connection-${offline.connectionState}`}
            onClick={() => setSyncOpen(true)}
            title="Open synchronization status"
          >
            {offline.connectionState === 'offline' ? <WifiOff size={16} /> : offline.connectionState === 'needs-attention' ? <AlertTriangle size={16} /> : <Cloud size={16} />}
            <span>{statusLabel}</span>
          </button>
          <div className="avatar" aria-hidden="true">
            {context.profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="account-copy">
            <strong>{context.profile.display_name}</strong>
            <span>{user?.email}</span>
          </div>
          <button className="header-signout" onClick={signOut} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      <main className="app-main">{children}</main>
      <Modal open={syncOpen} onClose={() => setSyncOpen(false)} title="Synchronization" description="Offline changes are stored on this device until Kitchen can safely apply them." size="small">
        <div className="sync-summary">
          <span className={`sync-state connection-${offline.connectionState}`}>{statusLabel}</span>
          {navigator.onLine && offline.operations.length ? <Button variant="secondary" onClick={() => void offline.synchronize()}><RefreshCw size={16} /> Sync now</Button> : null}
        </div>
        {!session && navigator.onLine ? (
          <div className="notice notice-warning" role="alert">
            <div><strong>Your session needs refreshing</strong><p>Sign in again to synchronize. Pending changes will remain on this device.</p></div>
            <Button variant="secondary" onClick={signInAgain}>Sign in again</Button>
          </div>
        ) : null}
        {!offline.operations.length ? (session ? <p className="sync-empty">Everything on this device is synchronized.</p> : null) : (
          <div className="sync-operations">
            {offline.operations.map((operation) => (
              <article key={operation.id} className={`sync-operation sync-${operation.status}`}>
                <div><strong>{operationLabel(operation)}</strong><span>{summary(operation.payload)}</span></div>
                {operation.error_message ? <p>{operation.error_message}</p> : null}
                {operation.status === 'conflict' ? (
                  <div className="conflict-comparison">
                    <span><small>Latest server version</small>{!operation.latest && operation.error_code !== 'P0002' ? 'Loading the latest version…' : summary(operation.latest)}</span>
                    <span><small>Your offline draft</small>{summary(operation.payload)}</span>
                  </div>
                ) : null}
                {(operation.status === 'conflict' || operation.status === 'failed') ? (
                  <div className="sync-actions">
                    <Button variant="ghost" onClick={() => void offline.discard(operation)}>{operation.status === 'conflict' ? 'Use latest' : 'Discard'}</Button>
                    {operation.status === 'conflict' ? <Button disabled={!operation.latest && operation.error_code !== 'P0002'} onClick={() => void offline.applyDraft(operation)}>Apply my version</Button> : <Button onClick={() => void offline.retry(operation)}>Retry</Button>}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
