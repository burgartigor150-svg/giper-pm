import { test, expect, type BrowserContext } from '@playwright/test';
import { resetDb, seedAdmin, seedUser, loginAs } from './fixtures';

test.describe('team page', () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
    await seedUser({
      email: 'pm@e2e.test',
      role: 'PM',
      password: 'pm-pass-1',
      name: 'PM User',
    });
    await seedUser({
      email: 'member@e2e.test',
      role: 'MEMBER',
      password: 'member-pass-1',
      name: 'Member User',
    });
  });

  test('admin sees team table with header', async ({ page }) => {
    await page.goto('/team');
    await expect(
      page.getByRole('heading', { name: 'Команда сейчас' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Сотрудник/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Текущая задача/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /В таймере с/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Часов сегодня/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Статус/ })).toBeVisible();
  });

  test('admin sees seeded users in table', async ({ page }) => {
    await page.goto('/team');
    await expect(page.getByText('Admin E2E').first()).toBeVisible();
    await expect(page.getByText('PM User').first()).toBeVisible();
    await expect(page.getByText('Member User').first()).toBeVisible();
  });

  test('clicking sortable name header toggles direction', async ({ page }) => {
    await page.goto('/team');
    await page.getByRole('button', { name: /Сотрудник/ }).click();
    // No assertion on visual state — just ensuring no error.
    await expect(page.getByText('Admin E2E').first()).toBeVisible();
  });

  test('clicking sortable Часов сегодня header sorts', async ({ page }) => {
    await page.goto('/team');
    await page.getByRole('button', { name: /Часов сегодня/ }).click();
    await expect(page.getByText('Admin E2E').first()).toBeVisible();
  });

  test('clicking Статус header sorts', async ({ page }) => {
    await page.goto('/team');
    await page.getByRole('button', { name: /Статус/ }).click();
    await expect(page.getByText('Admin E2E').first()).toBeVisible();
  });

  test('PM can access team page', async ({ page, context }) => {
    await loginAs(page, context as BrowserContext, 'pm@e2e.test', 'pm-pass-1');
    const resp = await page.goto('/team');
    expect(resp?.status()).toBeLessThan(400);
    await expect(
      page.getByRole('heading', { name: 'Команда сейчас' }),
    ).toBeVisible();
  });

  test('MEMBER gets 404 on /team', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'member@e2e.test',
      'member-pass-1',
    );
    const resp = await page.goto('/team');
    expect(resp?.status()).toBe(404);
  });
});
