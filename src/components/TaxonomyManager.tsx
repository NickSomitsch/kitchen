import { CirclePlus, Pencil, Tag, Trash2 } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createTaxonomy,
  deleteTaxonomy,
  queryKeys,
  updateTaxonomy,
} from '../api/kitchen'
import { getErrorMessage } from '../lib/errors'
import type { Category, InventoryItem, StorageLocation } from '../types/database'
import { Button, ErrorNotice, FieldError, IconButton, Modal } from './ui'

type Taxonomy = Category | StorageLocation

export function TaxonomyManager({
  type,
  householdId,
  values,
  inventory,
  offline = false,
}: {
  type: 'categories' | 'locations'
  householdId: string
  values: Taxonomy[]
  inventory: InventoryItem[]
  offline?: boolean
}) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<Taxonomy | undefined>()
  const [deleting, setDeleting] = useState<Taxonomy | undefined>()
  const [name, setName] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const singular = type === 'categories' ? 'category' : 'location'

  const formMutation = useMutation({
    mutationFn: () =>
      editing
        ? updateTaxonomy(type, editing.id, name.trim())
        : createTaxonomy(type, householdId, name.trim()),
    onSuccess: async () => {
      setFormOpen(false)
      setEditing(undefined)
      setName('')
      await queryClient.invalidateQueries({
        queryKey: type === 'categories'
          ? queryKeys.categories(householdId)
          : queryKeys.locations(householdId),
      })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteTaxonomy(type, deleting!.id),
    onSuccess: async () => {
      setDeleting(undefined)
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: type === 'categories'
            ? queryKeys.categories(householdId)
            : queryKeys.locations(householdId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) }),
      ])
    },
  })

  function usageCount(value: Taxonomy) {
    return inventory.filter((item) =>
      type === 'categories' ? item.category_id === value.id : item.location_id === value.id,
    ).length
  }

  function openCreate() {
    setEditing(undefined)
    setName('')
    setFormOpen(true)
  }

  function openEdit(value: Taxonomy) {
    setEditing(value)
    setName(value.name)
    setFormOpen(true)
  }

  return (
    <section className="settings-card taxonomy-card">
      <div className="settings-card-heading">
        <div><span className="settings-icon"><Tag size={19} /></span><div><h2>{type === 'categories' ? 'Categories' : 'Storage locations'}</h2><p>{type === 'categories' ? 'Group similar foods for faster filtering.' : 'Keep track of where every item is stored.'}</p></div></div>
        <Button variant="secondary" disabled={offline} onClick={openCreate}><CirclePlus size={17} /> Add {singular}</Button>
      </div>
      <div className="taxonomy-list">
        {values.map((value) => {
          const count = usageCount(value)
          return (
            <div className="taxonomy-row" key={value.id}>
              <span className="taxonomy-dot" aria-hidden="true" />
              <div><strong>{value.name}</strong><span>{count} {count === 1 ? 'item' : 'items'}</span></div>
              <IconButton label={`Rename ${value.name}`} disabled={offline} onClick={() => openEdit(value)}><Pencil size={16} /></IconButton>
              <IconButton label={`Delete ${value.name}`} disabled={offline} className="danger-icon" onClick={() => setDeleting(value)}><Trash2 size={16} /></IconButton>
            </div>
          )
        })}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? `Rename ${singular}` : `Add ${singular}`} size="small">
        <form className="simple-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) formMutation.mutate() }}>
          <label className="field"><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus /></label>
          {formMutation.isError ? <FieldError message={getErrorMessage(formMutation.error)} /> : null}
          <div className="modal-actions"><Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button><Button type="submit" busy={formMutation.isPending} disabled={!name.trim()}>{editing ? 'Save name' : `Add ${singular}`}</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(undefined)} title={`Delete ${deleting?.name ?? singular}?`} description={deleting && usageCount(deleting) ? `${usageCount(deleting)} inventory ${usageCount(deleting) === 1 ? 'item uses' : 'items use'} this ${singular}. The field will be cleared on those items.` : `This removes the ${singular} from your household.`} size="small">
        {deleteMutation.isError ? <ErrorNotice message={getErrorMessage(deleteMutation.error)} /> : null}
        <div className="modal-actions"><Button variant="secondary" onClick={() => setDeleting(undefined)}>Cancel</Button><Button variant="danger" busy={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}><Trash2 size={17} /> Delete {singular}</Button></div>
      </Modal>
    </section>
  )
}
