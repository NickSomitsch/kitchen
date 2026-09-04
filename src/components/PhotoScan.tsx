import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Camera, CheckCheck, ImagePlus, Receipt, ShoppingCart, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  RecognitionUnavailableError,
  createGroceryItem,
  createInventoryItem,
  queryKeys,
  recognizeImage,
} from '../api/kitchen'
import { useAuth } from '../auth/AuthContext'
import { getErrorMessage } from '../lib/errors'
import { SCAN_MAX_EDGE, toScanDataUrl } from '../lib/image'
import { UNITS } from '../lib/inventory'
import type {
  Category,
  ScanCandidate,
  ScanMode,
  ScanResult,
  StorageLocation,
  Unit,
} from '../types/database'
import { Button, ErrorNotice, FieldError, Modal } from './ui'

type Destination = 'inventory' | 'grocery'

interface DraftLine extends ScanCandidate {
  key: string
  include: boolean
  categoryId: string
}

function toDraft(
  candidate: ScanCandidate,
  categories: Category[],
  index: number,
): DraftLine {
  const matched = candidate.category
    ? categories.find(
      (category) => category.name.toLowerCase() === candidate.category?.trim().toLowerCase(),
    )
    : undefined
  return {
    ...candidate,
    key: `${index}-${candidate.name}`,
    include: candidate.confidence >= 0.45,
    categoryId: matched?.id ?? '',
  }
}

function confidenceLabel(confidence: number) {
  if (confidence >= 0.8) return { label: 'High', tone: 'high' }
  if (confidence >= 0.5) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}

/**
 * Photo and receipt recognition. The model only ever proposes lines; nothing reaches
 * the shared inventory until someone reviews and confirms this list.
 */
export function PhotoScanModal({
  open,
  householdId,
  categories,
  locations,
  onClose,
}: {
  open: boolean
  householdId: string
  categories: Category[]
  locations: StorageLocation[]
  onClose: () => void
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<ScanMode>('product')
  const [destination, setDestination] = useState<Destination>('inventory')
  const [locationId, setLocationId] = useState('')
  const [preview, setPreview] = useState('')
  const [result, setResult] = useState<ScanResult | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState('')

  function reset() {
    setPreview('')
    setResult(null)
    setLines([])
    setError('')
  }

  const recognition = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await toScanDataUrl(file, SCAN_MAX_EDGE[mode])
      setPreview(dataUrl)
      return recognizeImage(mode, dataUrl, {
        categories: categories.map((category) => category.name),
      })
    },
    onSuccess: (scan) => {
      setResult(scan)
      setLines(scan.candidates.map((candidate, index) => toDraft(candidate, categories, index)))
      setError('')
    },
    onError: (cause) => {
      if (cause instanceof RecognitionUnavailableError) setUnavailable(cause.message)
      else setError(getErrorMessage(cause))
      setPreview('')
    },
  })

  const apply = useMutation({
    mutationFn: async () => {
      const accepted = lines.filter((line) => line.include && line.name.trim())
      for (const line of accepted) {
        if (destination === 'inventory') {
          await createInventoryItem(householdId, user!.id, {
            name: line.name.trim(),
            quantity: line.quantity ?? 1,
            unit: line.unit ?? 'piece',
            category_id: line.categoryId || null,
            location_id: locationId || null,
            notes: line.brand ? `Brand: ${line.brand}` : null,
            low_stock_threshold: null,
            expires_on: null,
            barcode: null,
            brand: line.brand,
            image_url: null,
            nutrition: null,
          })
        } else {
          await createGroceryItem({
            inventory_item_id: null,
            name: line.name.trim(),
            quantity: line.quantity,
            unit: line.quantity === null ? null : line.unit ?? 'piece',
            category_id: line.categoryId || null,
            notes: null,
          })
        }
      }
      return accepted.length
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory(householdId) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.groceries(householdId) })
      reset()
      onClose()
    },
  })

  function update(key: string, changes: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...changes } : line)))
  }

  const includedCount = lines.filter((line) => line.include).length

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose() }}
      title={mode === 'receipt' ? 'Scan a receipt' : 'Scan a product photo'}
      description="Everything found is proposed for review. Nothing is added until you confirm."
      size="large"
    >
      {unavailable ? (
        <div className="notice notice-warning" role="alert">
          <div>
            <strong>Recognition is not set up</strong>
            <p>{unavailable}</p>
          </div>
        </div>
      ) : null}

      {!result ? (
        <div className="scan-intro">
          <div className="segmented-control" role="tablist" aria-label="Recognition mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'product'}
              className={mode === 'product' ? 'active' : ''}
              onClick={() => setMode('product')}
            >
              <Camera size={17} /> Products
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'receipt'}
              className={mode === 'receipt' ? 'active' : ''}
              onClick={() => setMode('receipt')}
            >
              <Receipt size={17} /> Receipt
            </button>
          </div>
          <p className="scan-hint">
            {mode === 'receipt'
              ? 'Photograph the whole receipt on a flat surface. Grocery lines are extracted; totals and payment lines are skipped.'
              : 'Photograph one or more products with their labels facing the camera.'}
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) recognition.mutate(file)
            }}
          />
          <Button
            type="button"
            busy={recognition.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={18} /> {recognition.isPending ? 'Reading the photo…' : 'Choose a photo'}
          </Button>
          {error ? <ErrorNotice message={error} /> : null}
        </div>
      ) : (
        <div className="scan-review">
          <div className="scan-review-head">
            {preview ? <img className="scan-preview" src={preview} alt="Scanned photo" /> : null}
            <div>
              <p className="eyebrow">Review before adding</p>
              <h3>
                {lines.length
                  ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'} found`
                  : 'Nothing recognised'}
              </h3>
              {result.store || result.purchased_on ? (
                <p className="muted-line">
                  {[result.store, result.purchased_on].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {result.notice ? <p className="scan-notice">{result.notice}</p> : null}
            </div>
          </div>

          {lines.length ? (
            <>
              <div className="scan-destination">
                <div className="segmented-control">
                  <button
                    type="button"
                    className={destination === 'inventory' ? 'active' : ''}
                    onClick={() => setDestination('inventory')}
                  >
                    <CheckCheck size={16} /> Into inventory
                  </button>
                  <button
                    type="button"
                    className={destination === 'grocery' ? 'active' : ''}
                    onClick={() => setDestination('grocery')}
                  >
                    <ShoppingCart size={16} /> Onto grocery list
                  </button>
                </div>
                {destination === 'inventory' ? (
                  <label className="field">
                    <span>Store everything in</span>
                    <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                      <option value="">No location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>{location.name}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <ul className="scan-lines">
                {lines.map((line) => {
                  const confidence = confidenceLabel(line.confidence)
                  return (
                    <li key={line.key} className={line.include ? '' : 'excluded'}>
                      <label className="scan-line-check">
                        <input
                          type="checkbox"
                          checked={line.include}
                          onChange={(event) => update(line.key, { include: event.target.checked })}
                          aria-label={`Include ${line.name}`}
                        />
                      </label>
                      <div className="scan-line-body">
                        <div className="scan-line-top">
                          <input
                            className="scan-line-name"
                            value={line.name}
                            onChange={(event) => update(line.key, { name: event.target.value })}
                            aria-label="Product name"
                          />
                          <span className={`confidence confidence-${confidence.tone}`}>
                            {confidence.label}
                          </span>
                        </div>
                        <div className="scan-line-fields">
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            placeholder="Qty"
                            value={line.quantity ?? ''}
                            onChange={(event) => update(line.key, {
                              quantity: event.target.value === '' ? null : Number(event.target.value),
                            })}
                            aria-label="Quantity"
                          />
                          <select
                            value={line.unit ?? 'piece'}
                            onChange={(event) => update(line.key, { unit: event.target.value as Unit })}
                            aria-label="Unit"
                          >
                            {UNITS.map((unit) => (
                              <option key={unit.value} value={unit.value}>{unit.shortLabel}</option>
                            ))}
                          </select>
                          <select
                            value={line.categoryId}
                            onChange={(event) => update(line.key, { categoryId: event.target.value })}
                            aria-label="Category"
                          >
                            <option value="">No category</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>{category.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="icon-button danger-icon"
                            aria-label={`Remove ${line.name}`}
                            onClick={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {line.note ? <p className="scan-line-note">{line.note}</p> : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p className="sync-empty">
              Try again with a sharper, better-lit photo, or add the items by hand.
            </p>
          )}

          {apply.isError ? <ErrorNotice message={getErrorMessage(apply.error)} /> : null}
          <FieldError message={error} />
          <div className="modal-actions">
            <Button type="button" variant="secondary" onClick={reset}>Scan another</Button>
            <Button
              type="button"
              busy={apply.isPending}
              disabled={!includedCount}
              onClick={() => apply.mutate()}
            >
              {destination === 'inventory' ? 'Add' : 'Add to list'}
              {includedCount ? ` ${includedCount}` : ''}
              {includedCount === 1 ? ' item' : ' items'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
