import { expect, test } from '@playwright/test'

test('black screen accepts join', async ({ page }) => {
  await page.goto('/')
  const root = page.getByTestId('gate-root')
  await expect(root).toBeVisible()
  await expect(page.getByRole('button', { name: '로그인' })).toHaveCount(0)
  await root.click()
  await page.keyboard.type('join')
  await expect(page.getByTestId('boot-text')).toContainText('WELCOME TO LIVEBRARY')
})
