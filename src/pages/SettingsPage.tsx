import {
  Check,
  Clipboard,
  KeyRound,
  LogOut,
  Pencil,
  RefreshCw,
  Trash2,
  UserMinus,
  Users,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  deleteHousehold,
  fetchCategories,
  fetchInventory,
  fetchLocations,
  fetchMembers,
  leaveHousehold,
  queryKeys,
  removeMember,
  rotateJoinCode,
  updateDisplayName,
  updateHouseholdName,
} from '../api/kitchen'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { TaxonomyManager } from '../components/TaxonomyManager'
import { Button, ErrorNotice, LoadingScreen, Modal } from '../components/ui'
import { useHousehold } from '../hooks/useHousehold'
import { getErrorMessage } from '../lib/errors'
import { formatJoinCode } from '../lib/inventory'
import type { HouseholdMember } from '../types/database'

export function SettingsPage() {
  const { user } = useAuth()
  const household = useHousehold()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const householdId = household.data?.household.id ?? ''
  const [householdNameDraft, setHouseholdNameDraft] = useState<string | null>(null)
  const [displayNameDraft, setDisplayNameDraft] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [removing, setRemoving] = useState<HouseholdMember | undefined>()
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')

  const inventory = useQuery({ queryKey: queryKeys.inventory(householdId), queryFn: () => fetchInventory(householdId), enabled: Boolean(householdId) })
  const categories = useQuery({ queryKey: queryKeys.categories(householdId), queryFn: () => fetchCategories(householdId), enabled: Boolean(householdId) })
  const locations = useQuery({ queryKey: queryKeys.locations(householdId), queryFn: () => fetchLocations(householdId), enabled: Boolean(householdId) })
  const members = useQuery({ queryKey: queryKeys.members(householdId), queryFn: () => fetchMembers(householdId), enabled: Boolean(householdId) })

  const householdNameMutation = useMutation({
    mutationFn: () => updateHouseholdName(householdId, (householdNameDraft ?? '').trim()),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.context }); setHouseholdNameDraft(null) },
  })
  const displayNameMutation = useMutation({
    mutationFn: () => updateDisplayName(user!.id, (displayNameDraft ?? '').trim()),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.context }); setDisplayNameDraft(null) },
  })
  const rotateMutation = useMutation({
    mutationFn: rotateJoinCode,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.context }),
  })
  const removeMutation = useMutation({
    mutationFn: () => removeMember(removing!.user_id),
    onSuccess: async () => { setRemoving(undefined); await queryClient.invalidateQueries({ queryKey: queryKeys.members(householdId) }) },
  })
  const leaveMutation = useMutation({
    mutationFn: leaveHousehold,
    onSuccess: async () => { queryClient.clear(); navigate('/onboarding', { replace: true }) },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteHousehold(deleteConfirmation),
    onSuccess: async () => { queryClient.clear(); navigate('/onboarding', { replace: true }) },
  })

  if (household.isLoading) return <LoadingScreen />
  if (household.isError) return <ErrorNotice message={getErrorMessage(household.error)} onRetry={() => void household.refetch()} />
  if (!household.data) return <Navigate to="/onboarding" replace />

  const context = household.data
  const householdName = householdNameDraft ?? context.household.name
  const displayName = displayNameDraft ?? context.profile.display_name
  const queryError = inventory.error ?? categories.error ?? locations.error ?? members.error
  const loading = inventory.isLoading || categories.isLoading || locations.isLoading || members.isLoading

  async function copyCode() {
    await navigator.clipboard.writeText(formatJoinCode(context.household.join_code))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <AppShell context={context}>
      <div className="page-container settings-page">
        <header className="page-heading"><div><p className="eyebrow">Shared kitchen</p><h1>Settings</h1><p>Manage your household, labels, and the people you share with.</p></div></header>
        {queryError ? <ErrorNotice message={getErrorMessage(queryError)} /> : loading ? <div className="inventory-skeleton"><span /><span /><span /></div> : (
          <div className="settings-stack">
            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-icon"><Pencil size={19} /></span><div><h2>Names</h2><p>How you and your household appear across Kitchen.</p></div></div></div>
              <div className="settings-form-grid">
                <form onSubmit={(event) => { event.preventDefault(); if (displayName.trim()) displayNameMutation.mutate() }}>
                  <label className="field"><span>Your display name</span><div className="inline-field"><input value={displayName} maxLength={80} onChange={(event) => setDisplayNameDraft(event.target.value)} /><Button type="submit" variant="secondary" busy={displayNameMutation.isPending} disabled={!displayName.trim() || displayName.trim() === context.profile.display_name}>Save</Button></div></label>
                  {displayNameMutation.isError ? <span className="field-error">{getErrorMessage(displayNameMutation.error)}</span> : null}
                </form>
                <form onSubmit={(event) => { event.preventDefault(); if (householdName.trim()) householdNameMutation.mutate() }}>
                  <label className="field"><span>Household name</span><div className="inline-field"><input value={householdName} maxLength={80} onChange={(event) => setHouseholdNameDraft(event.target.value)} /><Button type="submit" variant="secondary" busy={householdNameMutation.isPending} disabled={!householdName.trim() || householdName.trim() === context.household.name}>Save</Button></div></label>
                  {householdNameMutation.isError ? <span className="field-error">{getErrorMessage(householdNameMutation.error)}</span> : null}
                </form>
              </div>
            </section>

            <section className="settings-card join-card">
              <div className="settings-card-heading"><div><span className="settings-icon"><KeyRound size={19} /></span><div><h2>Household join code</h2><p>Anyone with this code can join after creating an account.</p></div></div></div>
              <div className="join-code-row"><code>{formatJoinCode(context.household.join_code)}</code><Button variant="secondary" onClick={() => void copyCode()}>{copied ? <Check size={17} /> : <Clipboard size={17} />}{copied ? 'Copied' : 'Copy code'}</Button><Button variant="ghost" busy={rotateMutation.isPending} onClick={() => rotateMutation.mutate()}><RefreshCw size={16} /> Rotate</Button></div>
              <p className="settings-hint">Rotating immediately invalidates the previous code.</p>
              {rotateMutation.isError ? <ErrorNotice message={getErrorMessage(rotateMutation.error)} /> : null}
            </section>

            <TaxonomyManager type="categories" householdId={householdId} values={categories.data ?? []} inventory={inventory.data ?? []} />
            <TaxonomyManager type="locations" householdId={householdId} values={locations.data ?? []} inventory={inventory.data ?? []} />

            <section className="settings-card">
              <div className="settings-card-heading"><div><span className="settings-icon"><Users size={19} /></span><div><h2>Household members</h2><p>Every member has equal access to inventory and settings.</p></div></div><span className="count-badge">{members.data?.length ?? 0}</span></div>
              <div className="member-list">
                {members.data?.map((member) => (
                  <div className="member-row" key={member.user_id}><span className="avatar">{(member.profile?.display_name ?? '?').slice(0, 1).toUpperCase()}</span><div><strong>{member.profile?.display_name ?? 'Household member'}{member.user_id === user?.id ? ' (you)' : ''}</strong><span>Joined {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(member.joined_at))}</span></div>{member.user_id !== user?.id ? <Button variant="ghost" onClick={() => setRemoving(member)}><UserMinus size={16} /> Remove</Button> : null}</div>
                ))}
              </div>
              <div className="member-footer"><Button variant="secondary" onClick={() => setLeaveOpen(true)}><LogOut size={16} /> Leave household</Button></div>
            </section>

            <section className="settings-card danger-zone">
              <div><h2>Delete household</h2><p>Permanently remove the household, inventory, categories, locations, and memberships.</p></div>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}><Trash2 size={17} /> Delete household</Button>
            </section>
          </div>
        )}
      </div>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(undefined)} title={`Remove ${removing?.profile?.display_name ?? 'member'}?`} description="They will lose access immediately and return to household setup." size="small">
        {removeMutation.isError ? <ErrorNotice message={getErrorMessage(removeMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setRemoving(undefined)}>Cancel</Button><Button variant="danger" busy={removeMutation.isPending} onClick={() => removeMutation.mutate()}><UserMinus size={17} /> Remove member</Button></div>
      </Modal>

      <Modal open={leaveOpen} onClose={() => setLeaveOpen(false)} title={`Leave ${context.household.name}?`} description="You will lose access to this inventory. You can join another household afterward." size="small">
        {members.data?.length === 1 ? <div className="notice notice-warning">The last member cannot leave. Delete the household instead.</div> : null}
        {leaveMutation.isError ? <ErrorNotice message={getErrorMessage(leaveMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setLeaveOpen(false)}>Stay</Button><Button variant="danger" busy={leaveMutation.isPending} disabled={members.data?.length === 1} onClick={() => leaveMutation.mutate()}><LogOut size={17} /> Leave household</Button></div>
      </Modal>

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this household?" description={`Type “${context.household.name}” to permanently delete all household data.`} size="small">
        <label className="field"><span>Household name</span><input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
        {deleteMutation.isError ? <ErrorNotice message={getErrorMessage(deleteMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" busy={deleteMutation.isPending} disabled={deleteConfirmation !== context.household.name} onClick={() => deleteMutation.mutate()}><Trash2 size={17} /> Delete permanently</Button></div>
      </Modal>
    </AppShell>
  )
}
