import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, HashRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { LoadingScreen } from './components/ui'
import { useHousehold } from './hooks/useHousehold'
import { isSupabaseConfigured } from './lib/supabase'
import { OfflineProvider } from './offline/OfflineContext'

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const GroceryPage = lazy(() => import('./pages/GroceryPage').then((module) => ({ default: module.GroceryPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false, networkMode: 'always' },
    mutations: { retry: 0, networkMode: 'always' },
  },
})

function HomeRoute() {
  const { user, loading } = useAuth()
  const household = useHousehold()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/auth" replace />
  if (household.isLoading) return <LoadingScreen />
  return <Navigate to={household.data ? '/inventory' : '/onboarding'} replace />
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/auth" replace />
  return children
}

function ConfigMissing() {
  return (
    <main className="config-missing">
      <div className="brand-mark"><span>K</span></div>
      <p className="eyebrow">Configuration needed</p>
      <h1>Connect your Supabase project</h1>
      <p>
        Copy <code>.env.example</code> to <code>.env.local</code>, then add your project URL and
        publishable key.
      </p>
    </main>
  )
}

export function App() {
  if (!isSupabaseConfigured) return <ConfigMissing />
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OfflineProvider>
          <HashRouter>
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route
                path="/onboarding"
                element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>}
              />
              <Route
                path="/inventory"
                element={<ProtectedRoute><InventoryPage /></ProtectedRoute>}
              />
              <Route
                path="/grocery"
                element={<ProtectedRoute><GroceryPage /></ProtectedRoute>}
              />
              <Route
                path="/settings"
                element={<ProtectedRoute><SettingsPage /></ProtectedRoute>}
              />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </HashRouter>
        </OfflineProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}
