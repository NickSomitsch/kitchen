import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { completeGroceryItem, queryKeys } from '../api/kitchen'
import { ConflictError } from '../lib/errors'
import { getUnitGroup, UNITS } from '../lib/inventory'
import { purchaseSchema, type PurchaseFormValues } from '../lib/validation'
import type { GroceryItem, InventoryItem, PurchaseInput, StorageLocation, Unit } from '../types/database'
import { Button, ErrorNotice, FieldError } from './ui'

export function PurchaseForm({
  householdId,
  item,
  inventory,
  locations,
  onClose,
}: {
  householdId: string
  item: GroceryItem
  inventory: InventoryItem[]
  locations: StorageLocation[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const linkedInventory = inventory.find((candidate) => candidate.id === item.inventory_item_id)
  const matchingInventory = inventory.find(
    (candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase(),
  )
  const defaultTarget = linkedInventory ?? matchingInventory
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<PurchaseFormValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: {
      stockAction: defaultTarget ? 'existing' : 'new',
      quantity: item.quantity?.toString() ?? '',
      unit: item.unit ?? defaultTarget?.unit ?? 'piece',
      targetInventoryItemId: defaultTarget?.id ?? '',
      locationId: '',
    },
  })
  const stockAction = useWatch({ control, name: 'stockAction' })
  const targetInventoryItemId = useWatch({ control, name: 'targetInventoryItemId' })
  const selectedUnit = useWatch({ control, name: 'unit' })
  const selectedTarget = inventory.find((candidate) => candidate.id === targetInventoryItemId)

  function changeTarget(event: React.ChangeEvent<HTMLSelectElement>) {
    const target = inventory.find((candidate) => candidate.id === event.target.value)
    setValue('targetInventoryItemId', event.target.value, { shouldValidate: true })
    if (target) setValue('unit', target.unit)
  }

  const mutation = useMutation({
    mutationFn: (values: PurchaseFormValues) => {
      const input: PurchaseInput = {
        stock_action: values.stockAction,
        quantity: values.stockAction === 'none' ? null : Number(values.quantity),
        unit: values.stockAction === 'none' ? null : values.unit,
        target_inventory_item_id: values.stockAction === 'existing' ? values.targetInventoryItemId : null,
        new_location_id: values.stockAction === 'new' ? (values.locationId || null) : null,
      }
      return completeGroceryItem(item, input)
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) }),
      ])
      onClose()
    },
  })

  const incompatible = selectedTarget && stockAction === 'existing'
    ? !UNITS.some((unit) => unit.value === selectedTarget.unit) ||
      getUnitGroup(selectedTarget.unit) !== getUnitGroup(selectedUnit as Unit)
    : false

  return (
    <form className="item-form" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
      <fieldset className="stock-action-options">
        <legend>What should happen next?</legend>
        <label><input type="radio" value="existing" {...register('stockAction')} /><span><strong>Add to existing inventory</strong><small>Increase an item already in your kitchen.</small></span></label>
        <label><input type="radio" value="new" {...register('stockAction')} /><span><strong>Create a new inventory item</strong><small>Start tracking this grocery after purchase.</small></span></label>
        <label><input type="radio" value="none" {...register('stockAction')} /><span><strong>Complete without stocking</strong><small>Useful for something you do not keep in inventory.</small></span></label>
      </fieldset>

      {stockAction !== 'none' ? (
        <div className="form-grid two-columns purchase-fields">
          {stockAction === 'existing' ? (
            <label className="field full-width">
              <span>Inventory item <b aria-hidden="true">*</b></span>
              <select {...register('targetInventoryItemId')} onChange={changeTarget}>
                <option value="">Choose an item</option>
                {inventory.map((inventoryItem) => <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name}</option>)}
              </select>
              <FieldError message={errors.targetInventoryItemId?.message} />
            </label>
          ) : null}
          <label className="field">
            <span>Purchased quantity <b aria-hidden="true">*</b></span>
            <input inputMode="decimal" {...register('quantity')} placeholder="How much did you buy?" />
            <FieldError message={errors.quantity?.message} />
          </label>
          <label className="field">
            <span>Unit <b aria-hidden="true">*</b></span>
            <select {...register('unit')}>
              {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
            </select>
          </label>
          {incompatible ? <p className="field-error full-width">Choose a unit compatible with {selectedTarget?.unit}.</p> : null}
          {stockAction === 'new' ? (
            <label className="field full-width">
              <span>Storage location <small>Optional</small></span>
              <select {...register('locationId')}>
                <option value="">No location</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {mutation.isError ? (
        mutation.error instanceof ConflictError ? (
          <div className="notice notice-warning" role="alert"><RefreshCw size={18} /><div><strong>This entry changed</strong><p>Close and reopen it before completing the purchase.</p></div></div>
        ) : <ErrorNotice message={mutation.error.message} />
      ) : null}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={mutation.isPending} disabled={incompatible}>Mark purchased</Button>
      </div>
    </form>
  )
}
