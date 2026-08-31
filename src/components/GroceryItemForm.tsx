import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createGroceryItem, queryKeys, updateGroceryItem } from '../api/kitchen'
import { ConflictError } from '../lib/errors'
import { findGroceryDuplicate, formatQuantity, UNITS } from '../lib/inventory'
import { groceryItemSchema, type GroceryItemFormValues } from '../lib/validation'
import type { Category, GroceryItem, GroceryItemInput, InventoryItem } from '../types/database'
import { Button, ErrorNotice, FieldError } from './ui'

export function GroceryItemForm({
  householdId,
  groceries,
  inventory,
  categories,
  item,
  initialInventoryItemId,
  onClose,
  onExisting,
}: {
  householdId: string
  groceries: GroceryItem[]
  inventory: InventoryItem[]
  categories: Category[]
  item?: GroceryItem
  initialInventoryItemId?: string
  onClose: () => void
  onExisting: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const defaultInventoryId = item?.inventory_item_id ?? initialInventoryItemId ?? ''
  const defaultInventory = inventory.find((candidate) => candidate.id === defaultInventoryId)
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<GroceryItemFormValues>({
    resolver: zodResolver(groceryItemSchema),
    defaultValues: {
      inventoryItemId: defaultInventoryId,
      name: item?.name ?? defaultInventory?.name ?? '',
      quantity: item?.quantity?.toString() ?? '',
      unit: item?.unit ?? defaultInventory?.unit ?? 'piece',
      categoryId: item?.category_id ?? defaultInventory?.category_id ?? '',
      notes: item?.notes ?? '',
    },
  })
  const inventoryItemId = useWatch({ control, name: 'inventoryItemId' })
  const name = useWatch({ control, name: 'name' })
  const notes = useWatch({ control, name: 'notes' })
  const selectedInventory = inventory.find((candidate) => candidate.id === inventoryItemId)
  const duplicate = useMemo(
    () => inventoryItemId ? undefined : findGroceryDuplicate(groceries, name, item?.id),
    [groceries, inventoryItemId, item?.id, name],
  )
  const linkedActive = groceries.find(
    (candidate) => candidate.status === 'active' && candidate.id !== item?.id &&
      candidate.inventory_item_id === inventoryItemId,
  )
  const inventoryRegistration = register('inventoryItemId')

  useEffect(() => {
    if (!selectedInventory) return
    setValue('name', selectedInventory.name, { shouldValidate: true })
    setValue('categoryId', selectedInventory.category_id ?? '')
    setValue('unit', selectedInventory.unit)
  }, [selectedInventory, setValue])

  const mutation = useMutation({
    mutationFn: async (values: GroceryItemFormValues) => {
      const linked = inventory.find((candidate) => candidate.id === values.inventoryItemId)
      const input: GroceryItemInput = {
        inventory_item_id: values.inventoryItemId || null,
        name: linked?.name ?? values.name.trim(),
        quantity: values.quantity ? Number(values.quantity) : null,
        unit: values.quantity ? values.unit : null,
        category_id: linked?.category_id ?? (values.categoryId || null),
        notes: values.notes.trim() || null,
      }
      if (item) return updateGroceryItem(item, input)
      return createGroceryItem(input)
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
      if (result && 'created' in result && !result.created) onExisting(result.grocery_item_id)
      else onClose()
    },
  })

  return (
    <form className="item-form" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
      <div className="form-grid two-columns">
        <label className="field full-width">
          <span>Link to inventory <small>Optional</small></span>
          {item?.source === 'low_stock' ? (
            <>
              <select value={inventoryItemId} disabled aria-describedby="inventory-link-help">
                {inventory.map((inventoryItem) => (
                  <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} · {formatQuantity(inventoryItem.quantity, inventoryItem.unit)}</option>
                ))}
              </select>
              <input type="hidden" {...inventoryRegistration} />
            </>
          ) : (
            <select
              {...inventoryRegistration}
              aria-describedby="inventory-link-help"
              onChange={(event) => void inventoryRegistration.onChange(event)}
            >
              <option value="">Free-form grocery</option>
              {inventory.map((inventoryItem) => (
                <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} · {formatQuantity(inventoryItem.quantity, inventoryItem.unit)}</option>
              ))}
            </select>
          )}
          <small id="inventory-link-help" className="field-help">Linked items update the existing inventory when purchased.</small>
        </label>

        {linkedActive ? (
          <div className="duplicate-warning full-width" role="status">
            <AlertTriangle size={19} />
            <div><strong>{linkedActive.name} is already on the list</strong><span>Open the existing entry instead of adding another.</span></div>
            <Button type="button" variant="ghost" onClick={() => onExisting(linkedActive.id)}>Open existing</Button>
          </div>
        ) : null}

        <label className="field full-width">
          <span>Name <b aria-hidden="true">*</b></span>
          <input {...register('name')} disabled={Boolean(selectedInventory)} placeholder="e.g. Olive oil" autoComplete="off" />
          <FieldError message={errors.name?.message} />
        </label>

        {duplicate ? (
          <div className="duplicate-warning full-width" role="status">
            <AlertTriangle size={19} />
            <div><strong>“{duplicate.name}” already exists</strong><span>You can still add an intentional free-form duplicate.</span></div>
            <Button type="button" variant="ghost" onClick={() => onExisting(duplicate.id)}>Open existing</Button>
          </div>
        ) : null}

        <label className="field">
          <span>Amount <small>Optional</small></span>
          <input inputMode="decimal" placeholder="How much?" {...register('quantity')} />
          <FieldError message={errors.quantity?.message} />
        </label>
        <label className="field">
          <span>Unit</span>
          <select {...register('unit')}>
            {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
        </label>
        <label className="field full-width">
          <span>Category <small>Optional</small></span>
          <select {...register('categoryId')} disabled={Boolean(selectedInventory)}>
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field full-width">
          <span>Notes <small>Optional</small></span>
          <textarea rows={3} {...register('notes')} placeholder="Brand, size, or anything useful…" />
          <div className="field-meta"><FieldError message={errors.notes?.message} /><span>{notes.length}/500</span></div>
        </label>
      </div>

      {mutation.isError ? (
        mutation.error instanceof ConflictError ? (
          <div className="notice notice-warning" role="alert"><RefreshCw size={18} /><div><strong>A newer version is available</strong><p>Your draft is preserved. Close and reopen the entry to load it.</p></div></div>
        ) : <ErrorNotice message={mutation.error.message} />
      ) : null}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={mutation.isPending} disabled={Boolean(linkedActive)}>{item ? 'Save changes' : 'Add to groceries'}</Button>
      </div>
    </form>
  )
}
