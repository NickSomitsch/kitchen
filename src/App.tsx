import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, HashRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { ErrorNotice, LoadingScreen } from './components/ui'
import { useHousehold } from './hooks/useHousehold'
import { getErrorMessage } from './lib/errors'
import { isSupabaseConfigured } from './lib/supabase'
import { OfflineProvider } from './offline/OfflineContext'

const AuthPage = lazy(() => import('./pages/AuthPage').then((module) => ({ default: module.AuthPage })))
const InventoryPage = lazy(() => import('./pages/InventoryPage').then((module) => ({ default: module.InventoryPage })))
const GroceryPage = lazy(() => import('./pages/GroceryPage').then((module) => ({ default: module.GroceryPage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })))
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })))
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const RecipesPage = lazy(() => import('./pages/RecipesPage').then((module) => ({ default: module.RecipesPage })))
const PlannerPage = lazy(() => import('./pages/PlannerPage').then((module) => ({ default: module.PlannerPage })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: 1, refetchOnWindowFocus: false, networkMode: 'always' },
    mutations: { retry: 0, networkMode: 'always' },
  },
})

function HomeRoute() {
  const { user, loading, signedOut } = useAuth()
  const household = useHousehold()
  if (loading) return <LoadingScreen />
  if (!user || signedOut) return <Navigate to="/auth" replace />
  if (household.isLoading) return <LoadingScreen />
  // Only a lookup that succeeded and found nothing means there is no kitchen yet.
  // Reading a failed request as "no kitchen" invites someone with a perfectly good
  // household to build a second one on top of it.
  if (household.isError) {
    return (
      <ErrorNotice
        message={getErrorMessage(household.error)}
        onRetry={() => void household.refetch()}
      />
    )
  }
  return <Navigate to={household.data ? '/home' : '/onboarding'} replace />
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, signedOut } = useAuth()
  if (loading) return <LoadingScreen />
  // A remembered user is enough to read the offline cache, but not to stay on a page
  // whose session the server has already rejected.
  if (!user || signedOut) return <Navigate to="/auth" replace />
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
                path="/home"
                element={<ProtectedRoute><HomePage /></ProtectedRoute>}
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
                path="/recipes"
                element={<ProtectedRoute><RecipesPage /></ProtectedRoute>}
              />
              <Route
                path="/planner"
                element={<ProtectedRoute><PlannerPage /></ProtectedRoute>}
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
