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
  return createdUser.id
}

async function offlineSnapshotCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('kitchen-offline-v1')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const transaction = request.result.transaction('snapshots', 'readonly')
      const count = transaction.objectStore('snapshots').count()
      count.onerror = () => reject(count.error)
      count.onsuccess = () => resolve(count.result)
    }
  }))
}

async function offlineOperations(page: Page) {
  return page.evaluate(() => new Promise<Array<{ status: string; kind: string; user: string; household: string; entity: string; payload: Record<string, unknown>; latest: Record<string, unknown> | null }>>((resolve, reject) => {
    const request = indexedDB.open('kitchen-offline-v1')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const transaction = request.result.transaction('operations', 'readonly')
      const values = transaction.objectStore('operations').getAll()
      values.onerror = () => reject(values.error)
      values.onsuccess = () => resolve(values.result.map((operation) => ({
        status: operation.status as string,
        kind: operation.kind as string,
        user: operation.user_id as string,
        household: operation.household_id as string,
        entity: operation.entity_id as string,
        payload: operation.payload as Record<string, unknown>,
        latest: operation.latest as Record<string, unknown> | null,
      })))
    }
  }))
}

test('two members share live inventory while another household stays isolated', async ({ browser }, testInfo) => {
  const stamp = `${Date.now()}-${testInfo.project.name}`
  const viewport = testInfo.project.name === 'mobile'
    ? { width: 390, height: 844 }
    : { width: 1280, height: 720 }
  const firstContext = await browser.newContext({ viewport })
  const secondContext = await browser.newContext({ viewport })
  const isolatedContext = await browser.newContext({ viewport })
  const first = await firstContext.newPage()
  const second = await secondContext.newPage()
  const isolated = await isolatedContext.newPage()
  const userIds: string[] = []
  const supabaseRoute = `${process.env.VITE_SUPABASE_URL}/**`

  await firstContext.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      if (localStorage.getItem('kitchen-e2e-api-offline') === 'true' && new URL(url, location.href).origin !== location.origin) {
        return Promise.reject(new TypeError('Failed to fetch'))
      }
      return nativeFetch(input, init)
    }
  })

  async function takeOffline() {
    await first.evaluate(() => localStorage.setItem('kitchen-e2e-api-offline', 'true'))
    await firstContext.route(supabaseRoute, (route) => route.abort('internetdisconnected'))
    await firstContext.setOffline(true)
  }

  async function reconnect() {
    await firstContext.setOffline(false)
    await firstContext.unroute(supabaseRoute)
    await first.evaluate(() => localStorage.removeItem('kitchen-e2e-api-offline'))
  }

  try {
    userIds.push(await signUp(first, 'Alex', `alex-${stamp}@example.test`))
    await first.getByLabel('Household name').fill('Test Kitchen')
    await first.getByRole('button', { name: 'Create my household' }).click()
    await expect(first.getByRole('heading', { name: 'Inventory' })).toBeVisible()
    await first.getByRole('link', { name: 'Settings', exact: true }).click()
    const joinCode = await first.locator('.join-code-row code').innerText()

    userIds.push(await signUp(second, 'Sam', `sam-${stamp}@example.test`))
    await second.getByRole('tab', { name: 'Join household' }).click()
    await second.getByLabel('Shared join code').fill(joinCode)
    await second.getByRole('button', { name: 'Join household' }).click()
    await expect(second.getByRole('heading', { name: 'Inventory' })).toBeVisible()

    await first.getByRole('link', { name: 'Inventory', exact: true }).click()
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

    // A controlled production service worker plus IndexedDB snapshots survive a full offline reload.
    await first.reload()
    await expect(first.getByRole('heading', { name: 'Inventory' })).toBeVisible()
    expect(await offlineSnapshotCount(first)).toBeGreaterThan(0)
    expect(await first.evaluate(() => localStorage.getItem('kitchen-offline-user-v1'))).not.toBeNull()
    await takeOffline()
    await first.reload()
    await expect(firstItem).toBeVisible()
    await first.getByRole('button', { name: 'Add item' }).click()
    const offlineDialog = first.getByRole('dialog', { name: 'Add inventory item' })
    await offlineDialog.getByLabel(/Item name/).fill('Offline lentils')
    await offlineDialog.getByRole('button', { name: 'Add to inventory' }).click()
    const offlineItem = first.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Offline lentils' })
    const queuedOperations = await offlineOperations(first)
    expect(queuedOperations).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'pending', kind: 'inventory.create' }),
    ]))
    await expect(offlineItem.getByText(/Pending sync/i)).toBeVisible()
    await first.reload()
    await expect(offlineItem).toBeVisible()
    await reconnect()
    await expect(second.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Offline lentils' })).toBeVisible({ timeout: 15_000 })

    // A stale offline edit is retained for review instead of overwriting another member.
    await takeOffline()
    await expect(first.evaluate(async (apiUrl) => {
      try {
        return (await fetch(`${apiUrl}/auth/v1/health`)).ok
      } catch {
        return false
      }
    }, process.env.VITE_SUPABASE_URL!)).resolves.toBe(false)
    await firstItem.getByRole('button').first().click()
    const offlineEdit = first.getByRole('dialog', { name: 'Edit inventory item' })
    await offlineEdit.getByLabel('Notes Optional').fill('Offline draft')
    await offlineEdit.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(async () => JSON.stringify(await offlineOperations(first))).toContain('inventory.update')
    await expect(offlineEdit).not.toBeVisible({ timeout: 5_000 })
    const staleOperation = (await offlineOperations(first)).find((operation) => operation.kind === 'inventory.update')
    expect(staleOperation).toBeDefined()
    await secondItem.getByRole('button').first().click()
    const serverEdit = second.getByRole('dialog', { name: 'Edit inventory item' })
    await serverEdit.getByLabel('Notes Optional').fill('Server draft')
    await serverEdit.getByRole('button', { name: 'Save changes' }).click()
    await expect.poll(async () => (await offlineOperations(second)).length, { timeout: 15_000 }).toBe(0)
    const serviceClient = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
    await expect.poll(async () => {
      const { data } = await serviceClient.from('inventory_items').select('notes,version').eq('id', staleOperation!.entity).single()
      return data?.notes === 'Server draft' && data.version > Number(staleOperation!.payload.expected_version)
    }, { timeout: 10_000 }).toBe(true)
    await reconnect()
    await first.reload()
    await expect(first.getByRole('heading', { name: 'Inventory' })).toBeVisible()
    await expect.poll(async () => (await offlineOperations(first))[0]?.status, { timeout: 15_000 }).toBe('conflict')
    await expect.poll(async () => Boolean((await offlineOperations(first))[0]?.latest), { timeout: 10_000 }).toBe(true)
    await first.getByTitle('Open synchronization status').click()
    const syncDialog = first.getByRole('dialog', { name: 'Synchronization' })
    await expect(syncDialog.getByText('Your offline draft')).toBeVisible()
    await syncDialog.getByRole('button', { name: 'Apply my version' }).click()
    await expect.poll(async () => (await offlineOperations(first)).length, { timeout: 15_000 }).toBe(0)
    await syncDialog.getByRole('button', { name: 'Close dialog' }).click()
    await expect.poll(async () => {
      await secondItem.getByRole('button').first().click()
      const resolvedEdit = second.getByRole('dialog', { name: 'Edit inventory item' })
      const notes = await resolvedEdit.getByLabel('Notes Optional').inputValue()
      await resolvedEdit.getByRole('button', { name: 'Cancel' }).click()
      return notes
    }, { timeout: 10_000 }).toBe('Offline draft')

    await firstItem.getByRole('button').first().click()
    const thresholdDialog = first.getByRole('dialog', { name: 'Edit inventory item' })
    await thresholdDialog.getByLabel(/Low-stock rule/).check()
    await thresholdDialog.getByLabel(/Trigger at or below/).fill('3')
    await thresholdDialog.getByRole('button', { name: 'Save changes' }).click()

    await second.getByRole('link', { name: /Groceries/ }).click()
    const automaticGrocery = second.locator('.grocery-row').filter({ hasText: 'Realtime rice' })
    await expect(automaticGrocery.getByText('Automatic')).toBeVisible({ timeout: 10_000 })
    await automaticGrocery.getByRole('button', { name: 'Mark Realtime rice purchased' }).click()
    const purchaseDialog = second.getByRole('dialog', { name: 'Purchased Realtime rice?' })
    await purchaseDialog.getByLabel(/Purchased quantity/).fill('1')
    await purchaseDialog.getByRole('button', { name: 'Mark purchased' }).click()
    await expect(firstItem.getByText('3.5 kg')).toBeVisible({ timeout: 10_000 })
    await expect(automaticGrocery).not.toBeVisible({ timeout: 10_000 })

    await second.getByLabel('Quick-add grocery').fill('Dish soap')
    await second.getByRole('button', { name: 'Add', exact: true }).click()
    const soap = second.locator('.grocery-row').filter({ hasText: 'Dish soap' })
    await expect(soap).toBeVisible()
    await soap.getByRole('button', { name: 'Mark Dish soap purchased' }).click()
    const soapDialog = second.getByRole('dialog', { name: 'Purchased Dish soap?' })
    await soapDialog.getByRole('radio', { name: /Complete without stocking/ }).check()
    await soapDialog.getByRole('button', { name: 'Mark purchased' }).click()
    await second.getByText('Recently purchased').click()
    const soapHistory = second.locator('.history-list article').filter({ hasText: 'Dish soap' })
    await expect(soapHistory.getByText('Not stocked', { exact: false })).toBeVisible()
    await soapHistory.getByRole('button', { name: /Add again/ }).click()
    await expect(second.locator('.grocery-row').filter({ hasText: 'Dish soap' })).toBeVisible()

    await first.getByPlaceholder('Search your kitchen…').fill('not present')
    await expect(first.getByRole('heading', { name: 'No items match' })).toBeVisible()
    await first.getByRole('button', { name: 'Clear filters' }).click()
    await expect(firstItem).toBeVisible()

    userIds.push(await signUp(isolated, 'Taylor', `taylor-${stamp}@example.test`))
    await isolated.getByLabel('Household name').fill('Other Kitchen')
    await isolated.getByRole('button', { name: 'Create my household' }).click()
    await expect(isolated.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })).not.toBeVisible()
    await expect(isolated.getByRole('heading', { name: 'Your kitchen is ready to fill' })).toBeVisible()
    await isolated.getByRole('link', { name: /Groceries/ }).click()
    await expect(isolated.getByRole('heading', { name: 'Your grocery list is clear' })).toBeVisible()

    await second.getByRole('link', { name: 'Inventory', exact: true }).click()
    const deleteTarget = second.locator('.inventory-table-wrap:visible tr, .inventory-card:visible').filter({ hasText: 'Realtime rice' })
    await expect(deleteTarget).toBeVisible()
    const cardMenu = deleteTarget.locator('summary')
    if (await cardMenu.isVisible()) {
      await cardMenu.click()
      await deleteTarget.getByRole('button', { name: 'Delete', exact: true }).click()
    } else {
      await deleteTarget.getByRole('button', { name: 'Delete Realtime rice' }).click()
    }
    const deleteDialog = second.getByRole('dialog', { name: 'Delete Realtime rice?' })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(deleteDialog).not.toBeVisible({ timeout: 10_000 })
    await expect(firstItem).not.toBeVisible({ timeout: 10_000 })
  } finally {
    const url = process.env.VITE_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (url && serviceKey && userIds.length) {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
      const { data: memberships } = await admin
        .from('household_members')
        .select('household_id')
        .in('user_id', userIds)
      const householdIds = [...new Set(memberships?.map((member) => member.household_id) ?? [])]
      if (householdIds.length) await admin.from('households').delete().in('id', householdIds)
      for (const userId of userIds) await admin.auth.admin.deleteUser(userId)
    }
    await Promise.all([firstContext.close(), secondContext.close(), isolatedContext.close()])
  }
})
