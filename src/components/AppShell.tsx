import { Boxes, LogOut, Settings, ShoppingCart } from 'lucide-react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { fetchGroceries, queryKeys } from '../api/kitchen'
import { useHouseholdRealtime } from '../hooks/useHousehold'
import { supabase } from '../lib/supabase'
import type { HouseholdContext } from '../types/database'

export function AppShell({
  context,
  children,
}: {
  context: HouseholdContext
  children: React.ReactNode
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  useHouseholdRealtime(context.household.id)
  const groceries = useQuery({
    queryKey: queryKeys.groceries(context.household.id),
    queryFn: () => fetchGroceries(context.household.id),
  })
  const activeGroceries = (groceries.data ?? []).filter((item) => item.status === 'active')
  const lowStockGroceries = activeGroceries.filter((item) => item.source === 'low_stock').length

  async function signOut() {
    await supabase.auth.signOut()
    queryClient.clear()
    navigate('/auth', { replace: true })
  }

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
    </div>
  )
}
