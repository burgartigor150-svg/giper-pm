import { test, expect, type BrowserContext } from '@playwright/test';
import { resetDb, seedAdmin, seedUser, getPrisma, loginAs } from './fixtures';

test.describe('users management', () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
    await seedUser({
      email: 'edit-me@e2e.test',
      role: 'MEMBER',
      name: 'Edit Me',
      password: 'edit-pass-1',
    });
    await seedUser({
      email: 'reset-me@e2e.test',
      role: 'MEMBER',
      name: 'Reset Me',
      password: 'reset-pass-1',
    });
    await seedUser({
      email: 'deact-me@e2e.test',
      role: 'MEMBER',
      name: 'Deact Me',
      password: 'deact-pass-1',
    });
    await seedUser({
      email: 'plain@e2e.test',
      role: 'MEMBER',
      name: 'Plain Member',
      password: 'plain-pass-1',
    });
  });

  test('list page renders header and create button', async ({ page }) => {
    await page.goto('/settings/users');
    await expect(
      page.getByRole('heading', { name: 'Пользователи' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Добавить пользователя' }),
    ).toBeVisible();
  });

  test('list page shows seeded users', async ({ page }) => {
    await page.goto('/settings/users');
    await expect(page.getByText('Admin E2E').first()).toBeVisible();
    await expect(page.getByText('Edit Me').first()).toBeVisible();
  });

  test('Create user → temp password modal renders with copy button', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/settings/users/new');
    await page.fill('input[name="name"]', 'Brand New');
    await page.fill('input[name="email"]', 'brand-new@e2e.test');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Временный пароль создан')).toBeVisible();
    const code = page.locator('code');
    const tempPwd = await code.textContent();
    expect(tempPwd && tempPwd.length).toBeGreaterThan(4);
    await page.getByRole('button', { name: 'Скопировать' }).click();
    await expect(page.getByRole('button', { name: 'Скопировано' })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(tempPwd?.trim());
  });

  test('Create user redirects to list on close', async ({ page }) => {
    await page.goto('/settings/users/new');
    await page.fill('input[name="name"]', 'Another One');
    await page.fill('input[name="email"]', 'another@e2e.test');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Временный пароль создан')).toBeVisible();
    await page.getByRole('button', { name: 'Готово' }).click();
    await expect(page).toHaveURL(/\/settings\/users$/);
  });

  test('Edit user form saves changes', async ({ page }) => {
    const u = await getPrisma().user.findUniqueOrThrow({
      where: { email: 'edit-me@e2e.test' },
    });
    await page.goto(`/settings/users/${u.id}`);
    await page.fill('input[name="name"]', 'Edit Me Renamed');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(800);
    const after = await getPrisma().user.findUnique({
      where: { id: u.id },
      select: { name: true },
    });
    expect(after?.name).toBe('Edit Me Renamed');
  });

  test('Reset password shows modal and updates DB', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    page.on('dialog', (d) => d.accept());
    const u = await getPrisma().user.findUniqueOrThrow({
      where: { email: 'reset-me@e2e.test' },
    });
    const beforeHash = (await getPrisma().user.findUnique({
      where: { id: u.id },
      select: { passwordHash: true },
    }))?.passwordHash;
    await page.goto(`/settings/users/${u.id}`);
    await page.getByRole('button', { name: 'Сбросить пароль' }).click();
    await expect(page.getByText('Временный пароль создан')).toBeVisible();
    const after = await getPrisma().user.findUnique({
      where: { id: u.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(after?.passwordHash).not.toBe(beforeHash);
    expect(after?.mustChangePassword).toBe(true);
  });

  test('Deactivate user with confirm flips isActive', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const u = await getPrisma().user.findUniqueOrThrow({
      where: { email: 'deact-me@e2e.test' },
    });
    await page.goto(`/settings/users/${u.id}`);
    await page.getByRole('button', { name: 'Деактивировать' }).click();
    await page.waitForTimeout(1500);
    const after = await getPrisma().user.findUnique({
      where: { id: u.id },
      select: { isActive: true },
    });
    expect(after?.isActive).toBe(false);
  });

  test('Email duplicate produces conflict error', async ({ page }) => {
    await page.goto('/settings/users/new');
    await page.fill('input[name="name"]', 'Dup');
    await page.fill('input[name="email"]', 'edit-me@e2e.test');
    await page.click('button[type="submit"]');
    await expect(
      page.getByText('Пользователь с таким email уже существует'),
    ).toBeVisible();
  });

  test('MEMBER cannot access /settings/users (404)', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'plain@e2e.test',
      'plain-pass-1',
    );
    const resp = await page.goto('/settings/users');
    expect(resp?.status()).toBe(404);
  });

  test('MEMBER cannot open user edit page (404)', async ({
    page,
    context,
  }) => {
    const u = await getPrisma().user.findUniqueOrThrow({
      where: { email: 'edit-me@e2e.test' },
    });
    await loginAs(
      page,
      context as BrowserContext,
      'plain@e2e.test',
      'plain-pass-1',
    );
    const resp = await page.goto(`/settings/users/${u.id}`);
    expect(resp?.status()).toBe(404);
  });

  test('Cancel link returns to users list', async ({ page }) => {
    await page.goto('/settings/users/new');
    await page.getByRole('link', { name: 'Отмена' }).click();
    await expect(page).toHaveURL(/\/settings\/users$/);
  });
});
