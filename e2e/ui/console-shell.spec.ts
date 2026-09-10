import { test, expect } from '../lib/playwright/suite';
import { T } from '../lib/playwright/timeouts';

test('[P1] [V:console.shell] Console project rail and empty run filters', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await expect(page).toHaveURL(/\/console\/?$/);
  const rail = page.getByRole('navigation', { name: 'Projects' });
  await expect(rail).toBeVisible({ timeout: T.medium });
  await expect(rail.getByText('Archon', { exact: true })).toBeVisible();
  await expect(rail.getByText('console', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All projects', level: 1 })).toBeVisible();
  await expect(page.getByText('Every run, across every project.')).toBeVisible();
  await expect(page.getByText('Pick a project on the left to start a run.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All projects', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add project', exact: true })).toBeVisible();
  await expect(page.getByText('Nothing running right now.')).toBeVisible();
  await page.getByRole('button', { name: /^All \d+$/ }).click();
  await expect(page.getByText('No runs yet.')).toBeVisible();
});

test('[P1] [V:console.settings] Console Settings navigation and reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/console');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/console\/settings\/?$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Projects' })).toBeVisible();
});
