import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  createInventoryItem,
  queryKeys,
  updateInventoryItem,
} from '../api/kitchen'
import { useAuth } from '../auth/AuthContext'
import { ConflictError } from '../lib/errors'
import { convertQuantity, findDuplicate, formatQuantity, UNITS } from '../lib/inventory'
import { itemSchema, type ItemFormValues } from '../lib/validation'
import type {
  Category,
  InventoryItem,
  ItemInput,
  StorageLocation,
  Unit,
} from '../types/database'
import { Button, ErrorNotice, FieldError } from './ui'

export function ItemForm({
  householdId,
  items,
  categories,
  locations,
  item,
  onClose,
  onEditItem,
}: {
  householdId: string
  items: InventoryItem[]
  categories: Category[]
  locations: StorageLocation[]
  item?: InventoryItem
  onClose: () => void
  onEditItem: (item: InventoryItem) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const {
    register,
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: item?.name ?? '',
      quantity: item?.quantity ?? 1,
      unit: item?.unit ?? 'piece',
      categoryId: item?.category_id ?? '',
      locationId: item?.location_id ?? '',
      notes: item?.notes ?? '',
      lowStockEnabled: item?.low_stock_threshold !== null && item?.low_stock_threshold !== undefined,
      lowStockThreshold: item?.low_stock_threshold ?? 0,
    },
  })

  const name = useWatch({ control, name: 'name' })
  const notes = useWatch({ control, name: 'notes' })
  const lowStockEnabled = useWatch({ control, name: 'lowStockEnabled' })
  const selectedUnit = useWatch({ control, name: 'unit' })
  const duplicate = useMemo(
    () => findDuplicate(items, name, item?.id),
    [items, name, item?.id],
  )

  const mutation = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      const input: ItemInput = {
        name: values.name.trim(),
        quantity: values.quantity,
        unit: values.unit,
        category_id: values.categoryId || null,
        location_id: values.locationId || null,
        notes: values.notes.trim() || null,
        low_stock_threshold: values.lowStockEnabled ? values.lowStockThreshold : null,
      }
      if (item) return updateInventoryItem(item, input)
      return createInventoryItem(householdId, user!.id, input)
    },
    onSuccess: () => {
      onClose()
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
    },
  })

  function changeUnit(event: React.ChangeEvent<HTMLSelectElement>) {
    const from = getValues('unit')
    const to = event.target.value as Unit
    const quantity = getValues('quantity')
    const threshold = getValues('lowStockThreshold')
    setValue('unit', to, { shouldDirty: true, shouldValidate: true })
    if (from === to) return
    const converted = convertQuantity(quantity, from, to)
    if (converted === null) {
      setValue('quantity', Number.NaN, { shouldDirty: true, shouldValidate: true })
      if (getValues('lowStockEnabled')) {
        setValue('lowStockThreshold', Number.NaN, { shouldDirty: true, shouldValidate: true })
      }
    } else {
      setValue('quantity', converted, { shouldDirty: true, shouldValidate: true })
      if (getValues('lowStockEnabled')) {
        const convertedThreshold = convertQuantity(threshold, from, to)
        setValue('lowStockThreshold', convertedThreshold ?? Number.NaN, { shouldDirty: true, shouldValidate: true })
      }
    }
  }

  return (
    <form className="item-form" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
      <div className="form-grid two-columns">
        <label className="field full-width">
          <span>Item name <b aria-hidden="true">*</b></span>
          <input {...register('name')} placeholder="e.g. Basmati rice" autoComplete="off" />
          <FieldError message={errors.name?.message} />
        </label>
        {duplicate ? (
          <div className="duplicate-warning full-width" role="status">
            <AlertTriangle size={19} />
            <div><strong>“{duplicate.name}” already exists</strong><span>{formatQuantity(duplicate.quantity, duplicate.unit)} currently recorded.</span></div>
            <Button type="button" variant="ghost" onClick={() => onEditItem(duplicate)}>Edit existing <ArrowRight size={15} /></Button>
          </div>
        ) : null}
        <label className="field">
          <span>Quantity <b aria-hidden="true">*</b></span>
          <input type="number" min="0" max="999999999.999" step="0.001" inputMode="decimal" {...register('quantity', { valueAsNumber: true })} />
          <FieldError message={errors.quantity?.message} />
        </label>
        <label className="field">
          <span>Unit <b aria-hidden="true">*</b></span>
          <select {...register('unit')} onChange={changeUnit}>
            {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </select>
          <FieldError message={errors.unit?.message} />
        </label>
        <label className="field">
          <span>Category</span>
          <select {...register('categoryId')}>
            <option value="">No category</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Location</span>
          <select {...register('locationId')}>
            <option value="">No location</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
        <label className="field full-width">
          <span>Notes <small>Optional</small></span>
          <textarea rows={3} {...register('notes')} placeholder="Brand, variety, or anything useful…" />
          <div className="field-meta"><FieldError message={errors.notes?.message} /><span>{notes.length}/500</span></div>
        </label>
        <div className="low-stock-rule full-width">
          <label className="check-row">
            <input type="checkbox" {...register('lowStockEnabled')} />
            <span><strong>Low-stock rule</strong><small>Automatically add this item to Groceries when its quantity reaches the threshold.</small></span>
          </label>
          {lowStockEnabled ? (
            <label className="field low-stock-threshold">
              <span>Trigger at or below ({selectedUnit})</span>
              <input type="number" min="0" max="999999999.999" step="0.001" inputMode="decimal" {...register('lowStockThreshold', { valueAsNumber: true })} />
              <FieldError message={errors.lowStockThreshold?.message} />
            </label>
          ) : null}
        </div>
      </div>
      {mutation.isError ? (
        mutation.error instanceof ConflictError ? (
          <div className="notice notice-warning" role="alert"><RefreshCw size={18} /><div><strong>A newer version is available</strong><p>Your draft is preserved. Close and reopen the item to load the latest changes.</p></div></div>
        ) : <ErrorNotice message={mutation.error.message} />
      ) : null}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={mutation.isPending}>{item ? 'Save changes' : 'Add to inventory'}</Button>
      </div>
    </form>
  )
}
