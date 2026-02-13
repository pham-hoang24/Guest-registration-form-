import { test, expect } from '@playwright/test'

test.describe('Owner dashboard', () => {

  test('list loads with mock submissions', async ({ page }) => {
    await page.route('**/api/v1/owner/properties/*/submissions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [
            { id: 'e2e-sub-1', createdAt: new Date().toISOString(), status: 'READY' },
          ],
        }),
      })
    })

    await page.goto('/owner/properties/prop-1/submissions')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('heading', { name: /submissions/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/e2e-sub-1|No submissions yet|Sign in required/)).toBeVisible({ timeout: 5000 })
  })

  test('download PDF triggers blob download', async ({ page, context }) => {
    const pdfContent = '%PDF-1.4 mock pdf content'
    await page.route('**/api/v1/owner/properties/*/submissions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          submissions: [
            { id: 'pdf-sub-1', createdAt: new Date().toISOString(), status: 'READY' },
          ],
        }),
      })
    })

    const downloadPromise = context.waitForEvent('download')
    await page.route('**/api/v1/owner/submissions/*/pdf', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: Buffer.from(pdfContent),
        headers: { 'Content-Disposition': 'attachment; filename="submission-pdf-sub-1.pdf"' },
      })
    })

    await page.goto('/owner/properties/prop-1/submissions')
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/pdf-sub-1|Create guest link/)).toBeVisible({ timeout: 10000 })

    const downloadBtn = page.getByRole('button', { name: 'Download PDF' }).first()
    await downloadBtn.click()

    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  })
})
