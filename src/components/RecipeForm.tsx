import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { GripVertical, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { queryKeys, saveRecipe } from '../api/kitchen'
import { ConflictError } from '../lib/errors'
import { UNITS } from '../lib/inventory'
import { RECIPE_TAG_SUGGESTIONS } from '../lib/recipes'
import { recipeSchema, type RecipeFormValues } from '../lib/validation'
import type { InventoryItem, Recipe, RecipeInput } from '../types/database'
import { Button, ErrorNotice, FieldError } from './ui'

const emptyIngredient = {
  name: '',
  quantity: '',
  unit: 'g' as const,
  optional: false,
  inventoryItemId: '',
}

function toDefaults(recipe?: Recipe): RecipeFormValues {
  if (!recipe) {
    return {
      name: '',
      description: '',
      instructions: '',
      servings: 2,
      prepMinutes: '',
      cookMinutes: '',
      sourceUrl: '',
      imageUrl: '',
      tags: [],
      ingredients: [{ ...emptyIngredient }],
    }
  }
  return {
    name: recipe.name,
    description: recipe.description ?? '',
    instructions: recipe.instructions ?? '',
    servings: recipe.servings,
    prepMinutes: recipe.prep_minutes?.toString() ?? '',
    cookMinutes: recipe.cook_minutes?.toString() ?? '',
    sourceUrl: recipe.source_url ?? '',
    imageUrl: recipe.image_url ?? '',
    tags: [...recipe.tags],
    ingredients: recipe.ingredients.length
      ? recipe.ingredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity?.toString() ?? '',
        unit: ingredient.unit ?? 'g',
        optional: ingredient.optional,
        inventoryItemId: ingredient.inventory_item_id ?? '',
      }))
      : [{ ...emptyIngredient }],
  }
}

export function RecipeForm({
  householdId,
  inventory,
  recipe,
  onClose,
}: {
  householdId: string
  inventory: InventoryItem[]
  recipe?: Recipe
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [tagDraft, setTagDraft] = useState('')
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RecipeFormValues>({
    resolver: zodResolver(recipeSchema),
    defaultValues: toDefaults(recipe),
  })
  const ingredients = useFieldArray({ control, name: 'ingredients' })
  const tags = useWatch({ control, name: 'tags' }) ?? []

  const mutation = useMutation({
    mutationFn: (values: RecipeFormValues) => {
      const input: RecipeInput = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        instructions: values.instructions.trim() || null,
        servings: values.servings,
        prep_minutes: values.prepMinutes ? Number(values.prepMinutes) : null,
        cook_minutes: values.cookMinutes ? Number(values.cookMinutes) : null,
        source_url: values.sourceUrl.trim() || null,
        image_url: values.imageUrl.trim() || null,
        tags: values.tags,
        ingredients: values.ingredients.map((ingredient) => {
          const matched = inventory.find(
            (item) => item.name.trim().toLowerCase() === ingredient.name.trim().toLowerCase(),
          )
          return {
            name: ingredient.name.trim(),
            quantity: ingredient.quantity ? Number(ingredient.quantity) : null,
            unit: ingredient.quantity ? ingredient.unit : null,
            optional: ingredient.optional,
            inventory_item_id: ingredient.inventoryItemId || matched?.id || null,
          }
        }),
      }
      return saveRecipe(input, recipe)
    },
    onSuccess: () => {
      onClose()
      void queryClient.invalidateQueries({ queryKey: queryKeys.recipes(householdId) })
    },
  })

  function addTag(value: string) {
    const tag = value.trim().toLowerCase()
    if (!tag || tag.length > 40) return
    const current = getValues('tags')
    if (current.includes(tag) || current.length >= 20) return
    setValue('tags', [...current, tag], { shouldDirty: true, shouldValidate: true })
    setTagDraft('')
  }

  return (
    <form className="item-form recipe-form" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
      <div className="form-grid two-columns">
        <label className="field full-width">
          <span>Recipe name <b aria-hidden="true">*</b></span>
          <input {...register('name')} placeholder="e.g. Weeknight tomato pasta" autoComplete="off" />
          <FieldError message={errors.name?.message} />
        </label>
        <label className="field full-width">
          <span>Short description <small>Optional</small></span>
          <input {...register('description')} placeholder="What makes it worth cooking?" autoComplete="off" />
          <FieldError message={errors.description?.message} />
        </label>
        <label className="field">
          <span>Serves <b aria-hidden="true">*</b></span>
          <input type="number" min="1" max="100" step="1" {...register('servings', { valueAsNumber: true })} />
          <FieldError message={errors.servings?.message} />
        </label>
        <div className="field time-fields">
          <span className="field-label">Time in minutes</span>
          <div>
            <input inputMode="numeric" placeholder="Prep" aria-label="Preparation minutes" {...register('prepMinutes')} />
            <input inputMode="numeric" placeholder="Cook" aria-label="Cooking minutes" {...register('cookMinutes')} />
          </div>
          <FieldError message={errors.prepMinutes?.message ?? errors.cookMinutes?.message} />
        </div>

        <div className="field full-width">
          <span className="field-label">Tags</span>
          {tags.length ? (
            <ul className="tag-list">
              {tags.map((tag) => (
                <li key={tag}>
                  <span className="soft-chip">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      onClick={() => setValue('tags', tags.filter((entry) => entry !== tag), { shouldDirty: true })}
                    >
                      <X size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                addTag(tagDraft)
              }
            }}
            onBlur={() => addTag(tagDraft)}
            placeholder="Type a tag and press Enter"
            aria-label="Add a tag"
            list="recipe-tag-suggestions"
            autoComplete="off"
          />
          <datalist id="recipe-tag-suggestions">
            {RECIPE_TAG_SUGGESTIONS.map((tag) => <option key={tag} value={tag} />)}
          </datalist>
          <FieldError message={errors.tags?.message} />
        </div>

        <fieldset className="ingredient-editor full-width">
          <legend>Ingredients <b aria-hidden="true">*</b></legend>
          <p className="details-footnote">
            Names are matched against your inventory, so write them the way the item is
            recorded. Leave the amount blank when any quantity will do.
          </p>
          <ul>
            {ingredients.fields.map((field, index) => (
              <li key={field.id}>
                <GripVertical size={16} className="ingredient-handle" aria-hidden="true" />
                <input
                  className="ingredient-name"
                  placeholder="Ingredient"
                  list="inventory-names"
                  autoComplete="off"
                  aria-label={`Ingredient ${index + 1} name`}
                  {...register(`ingredients.${index}.name` as const)}
                />
                <input
                  className="ingredient-quantity"
                  inputMode="decimal"
                  placeholder="Amount"
                  aria-label={`Ingredient ${index + 1} amount`}
                  {...register(`ingredients.${index}.quantity` as const)}
                />
                <select
                  aria-label={`Ingredient ${index + 1} unit`}
                  {...register(`ingredients.${index}.unit` as const)}
                >
                  {UNITS.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.shortLabel}</option>
                  ))}
                </select>
                <label className="ingredient-optional">
                  <input type="checkbox" {...register(`ingredients.${index}.optional` as const)} />
                  <span>Optional</span>
                </label>
                <button
                  type="button"
                  className="icon-button danger-icon"
                  aria-label={`Remove ingredient ${index + 1}`}
                  disabled={ingredients.fields.length === 1}
                  onClick={() => ingredients.remove(index)}
                >
                  <Trash2 size={16} />
                </button>
                <FieldError message={errors.ingredients?.[index]?.name?.message ?? errors.ingredients?.[index]?.quantity?.message} />
              </li>
            ))}
          </ul>
          <datalist id="inventory-names">
            {inventory.map((item) => <option key={item.id} value={item.name} />)}
          </datalist>
          <Button
            type="button"
            variant="secondary"
            onClick={() => ingredients.append({ ...emptyIngredient })}
          >
            <Plus size={16} /> Add ingredient
          </Button>
          <FieldError message={errors.ingredients?.message ?? errors.ingredients?.root?.message} />
        </fieldset>

        <label className="field full-width">
          <span>Method <small>Optional</small></span>
          <textarea rows={8} {...register('instructions')} placeholder={'1. Bring a pan of salted water to the boil.\n2. …'} />
          <FieldError message={errors.instructions?.message} />
        </label>
        <label className="field">
          <span>Source link <small>Optional</small></span>
          <input {...register('sourceUrl')} placeholder="https://…" autoComplete="off" inputMode="url" />
          <FieldError message={errors.sourceUrl?.message} />
        </label>
        <label className="field">
          <span>Photo link <small>Optional</small></span>
          <input {...register('imageUrl')} placeholder="https://…" autoComplete="off" inputMode="url" />
          <FieldError message={errors.imageUrl?.message} />
        </label>
      </div>

      {mutation.isError ? (
        mutation.error instanceof ConflictError ? (
          <div className="notice notice-warning" role="alert">
            <RefreshCw size={18} />
            <div><strong>Someone else edited this recipe</strong><p>Close and reopen it to load their changes before saving yours.</p></div>
          </div>
        ) : <ErrorNotice message={mutation.error.message} />
      ) : null}
      <div className="modal-actions">
        <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" busy={mutation.isPending}>{recipe ? 'Save recipe' : 'Add recipe'}</Button>
      </div>
    </form>
  )
}
