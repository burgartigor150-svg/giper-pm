import { test, expect } from '@playwright/test';
import {
  resetDb,
  seedAdmin,
  seedUser,
  ADMIN_EMAIL,
  ADMIN_PASS,
} from './fixtures';

test.describe('auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
    await seedUser({
      email: 'must-change@e2e.test',
      role: 'MEMBER',
      password: 'temp-pass-1',
      mustChangePassword: true,
    });
    await seedUser({
      email: 'inactive@e2e.test',
      role: 'MEMBER',
      isActive: false,
      password: 'inactive-1',
    });
  });

  test('login page renders title and form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  });

  test('rejects wrong password', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', 'wrong-password');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  });

  test('rejects unknown email', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'nobody@e2e.test');
    await page.fill('input[name="password"]', 'whatever-1');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  });

  test('rejects inactive user', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'inactive@e2e.test');
    await page.fill('input[name="password"]', 'inactive-1');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Неверный email или пароль')).toBeVisible();
  });

  test('successful login redirects to dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASS);
    await Promise.all([
      page.waitForURL('**/dashboard', { timeout: 30_000 }),
      page.click('button[type="submit"]'),
    ]);
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('mustChangePassword user is redirected to /me/security', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'must-change@e2e.test');
    await page.fill('input[name="password"]', 'temp-pass-1');
    await Promise.all([
      page.waitForURL((u) => !u.toString().includes('/login'), {
        timeout: 30_000,
      }),
      page.click('button[type="submit"]'),
    ]);
    // Force-redirect happens at app layout for any non-/me/security path.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/me\/security$/);
    await expect(
      page.getByText('Перед началом работы смените временный пароль.'),
    ).toBeVisible();
  });

  test('unauthenticated user redirected from /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated user redirected from /projects', async ({ page }) => {
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout via UserMenu returns to /login', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', ADMIN_EMAIL);
    await page.fill('input[name="password"]', ADMIN_PASS);
    await Promise.all([
      page.waitForURL('**/dashboard'),
      page.click('button[type="submit"]'),
    ]);
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole('menuitem', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login form has email and password inputs as required', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toHaveAttribute(
      'required',
      '',
    );
    await expect(page.locator('input[name="password"]')).toHaveAttribute(
      'required',
      '',
    );
  });
});
