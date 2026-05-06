import { test, expect, type BrowserContext } from '@playwright/test';
import { resetDb, seedAdmin, seedUser, getPrisma, loginAs } from './fixtures';

test.describe('security / change password', () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
    await seedUser({
      email: 'changer@e2e.test',
      role: 'MEMBER',
      password: 'old-pass-1',
      name: 'Changer',
    });
    await seedUser({
      email: 'forced@e2e.test',
      role: 'MEMBER',
      password: 'temp-pass-1',
      mustChangePassword: true,
      name: 'Forced',
    });
  });

  test('security page shows the change-password form', async ({ page }) => {
    await page.goto('/me/security');
    await expect(
      page.getByRole('heading', { name: 'Безопасность' }),
    ).toBeVisible();
    await expect(page.locator('input[name="currentPassword"]')).toBeVisible();
    await expect(page.locator('input[name="newPassword"]')).toBeVisible();
    await expect(page.locator('input[name="confirmPassword"]')).toBeVisible();
  });

  test('wrong current password shows error', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'changer@e2e.test',
      'old-pass-1',
    );
    await page.goto('/me/security');
    await page.fill('input[name="currentPassword"]', 'wrong-1');
    await page.fill('input[name="newPassword"]', 'BrandNew-1');
    await page.fill('input[name="confirmPassword"]', 'BrandNew-1');
    await page.getByRole('button', { name: 'Сменить пароль' }).click();
    await expect(page.locator('p.text-destructive')).toBeVisible();
  });

  test('mismatched new passwords show validation error', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'changer@e2e.test',
      'old-pass-1',
    );
    await page.goto('/me/security');
    await page.fill('input[name="currentPassword"]', 'old-pass-1');
    await page.fill('input[name="newPassword"]', 'NewPass-1');
    await page.fill('input[name="confirmPassword"]', 'Different-1');
    await page.getByRole('button', { name: 'Сменить пароль' }).click();
    await expect(page.locator('p.text-destructive').first()).toBeVisible();
  });

  test('successful change forces logout to /login?changed=1', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'changer@e2e.test',
      'old-pass-1',
    );
    await page.goto('/me/security');
    await page.fill('input[name="currentPassword"]', 'old-pass-1');
    await page.fill('input[name="newPassword"]', 'NewPass-9-abcdef');
    await page.fill('input[name="confirmPassword"]', 'NewPass-9-abcdef');
    await Promise.all([
      page.waitForURL((u) => /\/login/.test(u.toString()), { timeout: 30_000 }),
      page.getByRole('button', { name: 'Сменить пароль' }).click(),
    ]);
    await expect(page.getByText('Пароль изменён.')).toBeVisible();
    // Verify DB updated.
    const u = await getPrisma().user.findUnique({
      where: { email: 'changer@e2e.test' },
      select: { lastPasswordChangeAt: true },
    });
    expect(u?.lastPasswordChangeAt).not.toBeNull();
  });

  test('login with new password works', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'changer@e2e.test',
      'NewPass-9-abcdef',
    );
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('forced user redirected to /me/security on dashboard nav', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'forced@e2e.test',
      'temp-pass-1',
    );
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/me\/security$/);
    await expect(page.getByText('Перед началом работы')).toBeVisible();
  });
});
