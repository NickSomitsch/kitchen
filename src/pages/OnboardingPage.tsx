import { ArrowRight, Home, KeyRound, LogOut, UsersRound } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { createHousehold, joinHousehold, queryKeys } from '../api/kitchen'
import { Button, ErrorNotice, LoadingScreen } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'

export function OnboardingPage() {
  const household = useHousehold()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createHousehold(name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.context })
      navigate('/inventory', { replace: true })
    },
  })
  const joinMutation = useMutation({
    mutationFn: () => joinHousehold(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.context })
      navigate('/inventory', { replace: true })
    },
  })

  if (household.isLoading) return <LoadingScreen />
  if (household.data) return <Navigate to="/inventory" replace />
  if (household.isError) {
    return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  }

  const mutation = tab === 'create' ? createMutation : joinMutation
  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <div className="auth-brand dark"><div className="brand-mark"><span>K</span></div> Kitchen</div>
        <button onClick={() => void supabase.auth.signOut()} className="text-button"><LogOut size={17} /> Sign out</button>
      </header>
      <section className="onboarding-card">
        <div className="onboarding-intro">
          <p className="eyebrow">One last step</p>
          <h1>Where does your food live?</h1>
          <p>Create a new shared kitchen or use a code from someone in your household.</p>
        </div>
        <div className="segmented-control" role="tablist" aria-label="Household setup choice">
          <button role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'active' : ''} onClick={() => setTab('create')}><Home size={18} /> Create household</button>
          <button role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'active' : ''} onClick={() => setTab('join')}><UsersRound size={18} /> Join household</button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (tab === 'create' && name.trim()) createMutation.mutate()
            if (tab === 'join' && code.trim()) joinMutation.mutate()
          }}
          className="onboarding-form"
        >
          {tab === 'create' ? (
            <label><span>Household name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="The Green Kitchen" autoFocus /><small>You can change this later.</small></label>
          ) : (
            <label><span>Shared join code</span><div className="input-with-icon"><KeyRound size={18} /><input value={code} maxLength={11} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ABCDE-FGHIJ" autoFocus /></div><small>Codes ignore capitalisation, spaces, and hyphens.</small></label>
          )}
          {mutation.isError ? <ErrorNotice message={getErrorMessage(mutation.error)} /> : null}
          <Button type="submit" busy={mutation.isPending} disabled={tab === 'create' ? !name.trim() : !code.trim()}>
            {tab === 'create' ? 'Create my household' : 'Join household'} <ArrowRight size={17} />
          </Button>
        </form>
      </section>
    </main>
  )
}
