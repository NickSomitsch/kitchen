import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Barcode, CalendarClock, RefreshCw, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import {
  createInventoryItem,
  lookupProduct,
  queryKeys,
  updateInventoryItem,
} from '../api/kitchen'
import { useAuth } from '../auth/AuthContext'
import { ConflictError, getErrorMessage } from '../lib/errors'
import { expiryState, formatExpiry } from '../lib/expiry'
import { convertQuantity, findDuplicate, formatQuantity, UNITS } from '../lib/inventory'
import { NUTRIENT_FIELDS, nutritionFromForm, nutritionToForm } from '../lib/nutrition'
import { suggestCategory } from '../lib/openfoodfacts'
import { itemSchema, type ItemFormValues } from '../lib/validation'
import type {
  Category,
  InventoryItem,
  ItemInput,
  Nutrition,
  ProductFacts,
  StorageLocation,
  Unit,
} from '../types/database'
import { BarcodeScannerModal } from './BarcodeScanner'
import { Button, ErrorNotice, FieldError } from './ui'

export function ItemForm({
  householdId,
  items,
  categories,
  locations,
  item,
  prefill,
  onClose,
  onEditItem,
}: {
  householdId: string
  items: InventoryItem[]
  categories: Category[]
  locations: StorageLocation[]
  item?: InventoryItem
  prefill?: ProductFacts
  onClose: () => void
  onEditItem: (item: InventoryItem) => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [lookupError, setLookupError] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(
    Boolean(item?.barcode || item?.nutrition || prefill),
  )
  const [nutriscore, setNutriscore] = useState(item?.nutrition?.nutriscore ?? null)
  const [productImage, setProductImage] = useState(item?.image_url ?? prefill?.image_url ?? '')

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
      name: item?.name ?? prefill?.name ?? '',
      quantity: item?.quantity ?? prefill?.package_quantity ?? 1,
      unit: item?.unit ?? prefill?.package_unit ?? 'piece',
      categoryId: item?.category_id
        ?? (prefill ? suggestCategory(prefill, categories) : '')
        ?? '',
      locationId: item?.location_id ?? '',
      notes: item?.notes ?? '',
      lowStockEnabled: item?.low_stock_threshold !== null && item?.low_stock_threshold !== undefined,
      lowStockThreshold: item?.low_stock_threshold ?? 0,
      expiresOn: item?.expires_on ?? '',
      barcode: item?.barcode ?? prefill?.barcode ?? '',
      brand: item?.brand ?? prefill?.brand ?? '',
      imageUrl: item?.image_url ?? prefill?.image_url ?? '',
      nutrition: nutritionToForm(
        item?.nutrition ?? prefill?.nutrition ?? null,
        item?.unit ?? prefill?.package_unit ?? undefined,
      ),
    },
  })

  const name = useWatch({ control, name: 'name' })
  const notes = useWatch({ control, name: 'notes' })
  const lowStockEnabled = useWatch({ control, name: 'lowStockEnabled' })
  const selectedUnit = useWatch({ control, name: 'unit' })
  const expiresOn = useWatch({ control, name: 'expiresOn' })
  const duplicate = useMemo(
    () => findDuplicate(items, name, item?.id),
    [items, name, item?.id],
  )
  const expiry = expiresOn ? expiryState({ expires_on: expiresOn }) : 'none'

  const lookup = useMutation({
    mutationFn: (barcode: string) => lookupProduct(householdId, barcode),
    onSuccess: (facts) => {
      applyFacts(facts)
      setLookupError('')
    },
    onError: (error) => setLookupError(getErrorMessage(error)),
  })

  function applyFacts(facts: ProductFacts) {
    setDetailsOpen(true)
    setValue('barcode', facts.barcode, { shouldDirty: true })
    if (facts.name && !getValues('name').trim()) {
      setValue('name', facts.name, { shouldDirty: true, shouldValidate: true })
    }
    if (facts.brand) setValue('brand', facts.brand, { shouldDirty: true })
    if (facts.image_url) {
      setValue('imageUrl', facts.image_url, { shouldDirty: true })
      setProductImage(facts.image_url)
    }
    if (facts.package_quantity && facts.package_unit) {
      setValue('quantity', facts.package_quantity, { shouldDirty: true, shouldValidate: true })
      setValue('unit', facts.package_unit, { shouldDirty: true, shouldValidate: true })
    }
    if (facts.nutrition) {
      setValue('nutrition', nutritionToForm(facts.nutrition, facts.package_unit ?? undefined), {
        shouldDirty: true,
      })
      setNutriscore(facts.nutrition.nutriscore)
    }
    if (!getValues('categoryId')) {
      const suggested = suggestCategory(facts, categories)
      if (suggested) setValue('categoryId', suggested, { shouldDirty: true })
    }
  }

  const mutation = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      const nutrition = nutritionFromForm(values.nutrition, item?.nutrition ?? null)
      const input: ItemInput = {
        name: values.name.trim(),
        quantity: values.quantity,
        unit: values.unit,
        category_id: values.categoryId || null,
        location_id: values.locationId || null,
        notes: values.notes.trim() || null,
        low_stock_threshold: values.lowStockEnabled ? values.lowStockThreshold : null,
        expires_on: values.expiresOn || null,
        barcode: values.barcode.trim() || null,
        brand: values.brand.trim() || null,
        image_url: values.imageUrl.trim() || null,
        nutrition: nutrition
          ? ({ ...nutrition, nutriscore } as Nutrition)
          : null,
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
        <label className="field">
          <span>Best before <small>Optional</small></span>
          <input type="date" {...register('expiresOn')} />
          <div className="field-meta">
            <FieldError message={errors.expiresOn?.message} />
            {expiresOn && !errors.expiresOn ? (
              <span className={`expiry-hint expiry-${expiry}`}>
                <CalendarClock size={14} /> {formatExpiry(expiresOn)}
              </span>
            ) : null}
          </div>
        </label>
        <div className="field">
          <span className="field-label">Barcode</span>
          <div className="barcode-row">
            <input inputMode="numeric" placeholder="Not scanned" {...register('barcode')} />
            <Button type="button" variant="secondary" onClick={() => setScannerOpen(true)}>
              <Barcode size={17} /> Scan
            </Button>
          </div>
          <div className="field-meta">
            <FieldError message={errors.barcode?.message} />
            <button
              type="button"
              className="text-button"
              disabled={lookup.isPending}
              onClick={() => {
                const value = getValues('barcode').trim()
                if (value) lookup.mutate(value)
              }}
            >
              {lookup.isPending ? 'Looking up…' : 'Fill from Open Food Facts'}
            </button>
          </div>
        </div>
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

        <details
          className="product-details full-width"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>
            <Sparkles size={16} /> Brand and nutrition
            {nutriscore ? <b className={`nutriscore nutriscore-${nutriscore}`}>{nutriscore.toUpperCase()}</b> : null}
          </summary>
          <div className="product-details-body">
            {lookupError ? <ErrorNotice message={lookupError} /> : null}
            {productImage ? (
              <div className="product-thumb">
                <img src={productImage} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => { setProductImage(''); setValue('imageUrl', '', { shouldDirty: true }) }}
                >
                  <X size={14} /> Remove photo
                </button>
              </div>
            ) : null}
            <label className="field">
              <span>Brand</span>
              <input {...register('brand')} placeholder="e.g. Barilla" autoComplete="off" />
              <FieldError message={errors.brand?.message} />
            </label>
            <label className="field">
              <span>Serving size</span>
              <input {...register('nutrition.serving_size')} placeholder="e.g. 30 g" autoComplete="off" />
              <FieldError message={errors.nutrition?.serving_size?.message} />
            </label>
            <fieldset className="nutrition-grid">
              <legend>
                Per 100
                <select
                  {...register('nutrition.basis')}
                  aria-label="Nutrition basis"
                  className="nutrition-basis"
                >
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                </select>
              </legend>
              {NUTRIENT_FIELDS.map((nutrient) => (
                <label className="field" key={nutrient.key}>
                  <span>{nutrient.label} <small>{nutrient.suffix}</small></span>
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    {...register(`nutrition.${nutrient.key}` as const)}
                  />
                  <FieldError message={errors.nutrition?.[nutrient.key]?.message} />
                </label>
              ))}
            </fieldset>
            <p className="details-footnote">
              Product data comes from the community-maintained Open Food Facts database. It can be
              incomplete or wrong, so every field here stays editable.
            </p>
          </div>
        </details>
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

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={(barcode) => {
          setScannerOpen(false)
          setValue('barcode', barcode, { shouldDirty: true, shouldValidate: true })
          lookup.mutate(barcode)
        }}
      />
    </form>
  )
}
