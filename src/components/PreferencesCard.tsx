import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Leaf, X } from 'lucide-react'
import { useState } from 'react'
import { queryKeys, updateHouseholdPreferences } from '../api/kitchen'
import { getErrorMessage } from '../lib/errors'
import type { Household } from '../types/database'
import { Button, ErrorNotice } from './ui'

const DIET_SUGGESTIONS = [
  'vegetarian', 'vegan', 'pescatarian', 'gluten free', 'dairy free',
  'low carb', 'high protein', 'halal', 'kosher',
]

function TagEditor({
  label,
  hint,
  placeholder,
  suggestions,
  values,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  placeholder: string
  suggestions?: string[]
  values: string[]
  disabled: boolean
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const listId = `${label.replace(/\s+/g, '-').toLowerCase()}-suggestions`

  function add(value: string) {
    const tag = value.trim().toLowerCase()
    if (!tag || tag.length > 40 || values.includes(tag) || values.length >= 20) return
    onChange([...values, tag])
    setDraft('')
  }

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <p className="settings-hint">{hint}</p>
      {values.length ? (
        <ul className="tag-list">
          {values.map((tag) => (
            <li key={tag}>
              <span className="soft-chip">
                {tag}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${tag}`}
                  onClick={() => onChange(values.filter((entry) => entry !== tag))}
                >
                  <X size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={label}
        list={suggestions ? listId : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            add(draft)
          }
        }}
        onBlur={() => add(draft)}
      />
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
      ) : null}
    </div>
  )
}

/**
 * Household-wide preferences. Diet tags nudge matching recipes up the list; anything
 * on the avoid list is flagged and pushed to the bottom rather than hidden outright.
 */
export function PreferencesCard({
  household,
  offline,
}: {
  household: Household
  offline: boolean
}) {
  const queryClient = useQueryClient()
  const [diet, setDiet] = useState(household.diet_tags ?? [])
  const [avoid, setAvoid] = useState(household.avoid_ingredients ?? [])

  const mutation = useMutation({
    mutationFn: () => updateHouseholdPreferences(household.id, {
      diet_tags: diet,
      avoid_ingredients: avoid,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.context }),
  })

  const changed =
    JSON.stringify(diet) !== JSON.stringify(household.diet_tags ?? [])
    || JSON.stringify(avoid) !== JSON.stringify(household.avoid_ingredients ?? [])

  return (
    <section className="settings-card">
      <div className="settings-card-heading">
        <div>
          <span className="settings-icon"><Leaf size={19} /></span>
          <div>
            <h2>Dietary preferences</h2>
            <p>Shared by everyone in the household and applied when recipes are ranked.</p>
          </div>
        </div>
      </div>
      <div className="settings-form-grid">
        <TagEditor
          label="Diet tags"
          hint="Recipes carrying one of these tags are nudged up the list."
          placeholder="e.g. vegetarian"
          suggestions={DIET_SUGGESTIONS}
          values={diet}
          disabled={offline}
          onChange={setDiet}
        />
        <TagEditor
          label="Ingredients to avoid"
          hint="Allergies and dislikes. Matching recipes are flagged and sorted last."
          placeholder="e.g. peanuts"
          values={avoid}
          disabled={offline}
          onChange={setAvoid}
        />
      </div>
      {mutation.isError ? <ErrorNotice message={getErrorMessage(mutation.error)} /> : null}
      <div className="member-footer">
        <Button
          variant="secondary"
          busy={mutation.isPending}
          disabled={offline || !changed}
          onClick={() => mutation.mutate()}
        >
          Save preferences
        </Button>
      </div>
    </section>
  )
}
