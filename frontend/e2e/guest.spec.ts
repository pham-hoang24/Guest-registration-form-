import { test, expect } from '@playwright/test'

test.describe('Guest registration', () => {
  test('happy path: form loads with token, submit returns 202, success screen', async ({ page }) => {
    await page.route('**/api/v1/guest/register', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({ submissionId: 'e2e-sub-1', status: 'PENDING_PDF' }),
        })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/register/test-token-123')
    await page.waitForLoadState('networkidle')
    await expect(page.getByLabel('Full name')).toBeVisible({ timeout: 10000 })

    await page.getByLabel('Full name').fill('Jane Doe')
    await page.getByLabel('Document number').fill('AB123456')
    await page.getByLabel('Check-in date').fill('2025-02-15')
    await page.getByLabel('Check-out date').fill('2025-02-17')
    await page.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByText(/registration complete/i)).toBeVisible()
  })

  test('replay token: shows already submitted', async ({ page }) => {
    await page.route('**/api/v1/guest/register', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'token_replay' }),
        })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/register/replay-token')
    await page.waitForLoadState('networkidle')
    await expect(page.getByLabel('Full name')).toBeVisible({ timeout: 10000 })

    await page.getByLabel('Full name').fill('Jane Doe')
    await page.getByLabel('Document number').fill('AB123456')
    await page.getByLabel('Check-in date').fill('2025-02-15')
    await page.getByLabel('Check-out date').fill('2025-02-17')
    await page.getByRole('button', { name: 'Submit' }).click()

    await expect(page.getByText(/already submitted/i)).toBeVisible()
  })
})
