import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

test.describe.configure({ mode: 'serial' })
test.skip(!process.env.RUN_E2E, 'Set RUN_E2E=1 and provide a local Supabase instance.')

async function signUp(page: Page, name: string, email: string) {
  await page.goto('#/auth')
  await page.getByRole('button', { name: 'Create an account' }).click()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email address').fill(email)
  await page.locator('input[type="password"]').fill('Kitchen-test-123!')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText('Check your inbox to verify your email, then sign in.')).toBeVisible()

  const url = process.env.VITE_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase test administration is not configured.')
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin.auth.admin.listUsers()
  if (error) throw error
  const createdUser = data.users.find((candidate) => candidate.email === email)
  if (!createdUser) throw new Error(`Could not find test user ${email}.`)
  const { error: confirmError } = await admin.auth.admin.updateUserById(createdUser.id, {
    email_confirm: true,
  })
  if (confirmError) throw confirmError

  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Where does your food live?' })).toBeVisible()
}

test('two members share live inventory while another household stays isolated', async ({ browser }, testInfo) => {
  const stamp = Date.now()
  const viewport = testInfo.project.name === 'mobile'
    ? { width: 390, height: 844 }
    : { width: 1280, height: 720 }
  const firstContext = await browser.newContext({ viewport })
  const secondContext = await browser.newContext({ viewport })
  const isolatedContext = await browser.newContext({ viewport })
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const isolated = await isolatedContext.newPage()

  await signUp(first, 'Alex', `alex-${stamp}@example.test`)
  await first.getByLabel('Household name').fill('Test Kitchen')
  await first.getByRole('button', { name: 'Create my household' }).click()
  await expect(first.getByRole('heading', { name: 'Inventory' })).toBeVisible()
  await first.getByRole('link', { name: 'Settings' }).click()
  const joinCode = await first.locator('.join-code-row code').innerText()

  await signUp(second, 'Sam', `sam-${stamp}@example.test`)
  await second.getByRole('tab', { name: 'Join household' }).click()
  await second.getByLabel('Shared join code').fill(joinCode)
  await second.getByRole('button', { name: 'Join household' }).click()
  await expect(second.getByRole('heading', { name: 'Inventory' })).toBeVisible()

  await first.getByRole('link', { name: 'Inventory' }).click()
  await first.getByRole('button', { name: 'Add item' }).click()
  const addDialog = first.getByRole('dialog', { name: 'Add inventory item' })
  await addDialog.getByLabel(/Item name/).fill('Realtime rice')
  await addDialog.getByRole('combobox', { name: 'Unit' }).selectOption('kg')
  await addDialog.getByRole('spinbutton', { name: 'Quantity' }).fill('1')
  await addDialog.getByRole('button', { name: 'Add to inventory' }).click()
  const secondItem = second.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })
  await expect(secondItem).toBeVisible({ timeout: 10_000 })

  await secondItem.getByRole('button').first().click()
  const editDialog = second.getByRole('dialog', { name: 'Edit inventory item' })
  await editDialog.getByRole('spinbutton', { name: 'Quantity' }).fill('2.5')
  await editDialog.getByRole('button', { name: 'Save changes' }).click()
  const firstItem = first.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })
  await expect(firstItem.getByText('2.5 kg')).toBeVisible({ timeout: 10_000 })

  await first.getByPlaceholder('Search your kitchen…').fill('not present')
  await expect(first.getByRole('heading', { name: 'No items match' })).toBeVisible()
  await first.getByRole('button', { name: 'Clear filters' }).click()
  await expect(firstItem).toBeVisible()

  await signUp(isolated, 'Taylor', `taylor-${stamp}@example.test`)
  await isolated.getByLabel('Household name').fill('Other Kitchen')
  await isolated.getByRole('button', { name: 'Create my household' }).click()
  await expect(isolated.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })).not.toBeVisible()
  await expect(isolated.getByRole('heading', { name: 'Your kitchen is ready to fill' })).toBeVisible()

  const deleteTarget = second.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })
  const cardMenu = deleteTarget.locator('summary')
  if (await cardMenu.isVisible()) await cardMenu.click()
  await deleteTarget.getByRole('button', { name: /Delete/ }).click()
  await second.getByRole('button', { name: 'Delete permanently' }).click()
  await expect(firstItem).not.toBeVisible({ timeout: 10_000 })

  await Promise.all([firstContext.close(), secondContext.close(), isolatedContext.close()])
})
