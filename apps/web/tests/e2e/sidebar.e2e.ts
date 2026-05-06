import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin } from './fixtures';

test.describe('sidebar navigation', () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
  });

  test('clicking Дашборд navigates to /dashboard', async ({ page }) => {
    await page.goto('/projects');
    await page.locator('aside').getByRole('link', { name: 'Дашборд' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('clicking Проекты navigates to /projects', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Проекты' }).click();
    await expect(page).toHaveURL(/\/projects/);
  });

  test('clicking Время navigates to /time', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Время' }).click();
    await expect(page).toHaveURL(/\/time/);
  });

  test('clicking Команда navigates to /team', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Команда' }).click();
    await expect(page).toHaveURL(/\/team/);
  });

  test('clicking Отчёты navigates to /reports', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Отчёты' }).click();
    await expect(page).toHaveURL(/\/reports/);
  });

  test('clicking Настройки navigates to /settings', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('aside').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test('logo link navigates to /dashboard', async ({ page }) => {
    await page.goto('/projects');
    // Logo link contains "giper-pm"
    await page.locator('aside').getByRole('link', { name: 'giper-pm' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('current section link is highlighted', async ({ page }) => {
    await page.goto('/projects');
    const link = page.locator('aside').getByRole('link', { name: 'Проекты' });
    await expect(link).toHaveClass(/bg-accent/);
  });

  test('UserMenu button is visible in topbar', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(
      page.locator('header button[aria-haspopup="menu"]'),
    ).toBeVisible();
  });

  test('UserMenu opens with Безопасность and Выйти options', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('header button[aria-haspopup="menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Безопасность' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Выйти' })).toBeVisible();
  });

  test('Безопасность menuitem navigates to /me/security', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Безопасность' }).click();
    await expect(page).toHaveURL(/\/me\/security$/);
  });
});
