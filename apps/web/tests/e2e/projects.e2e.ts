import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, getPrisma } from './fixtures';

test.describe('projects', () => {
  let adminId: string;

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    await seedProject({ key: 'GFM', name: 'Giper FM', ownerId: adminId });
    await seedProject({ key: 'OPS', name: 'Operations', ownerId: adminId });
    // archived
    const arch = await seedProject({
      key: 'OLD',
      name: 'Archived',
      ownerId: adminId,
    });
    await getPrisma().project.update({
      where: { id: arch.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
  });

  test('list page renders title and projects', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.getByRole('heading', { name: 'Проекты' })).toBeVisible();
    await expect(page.getByText('Giper FM').first()).toBeVisible();
    await expect(page.getByText('Operations').first()).toBeVisible();
  });

  test('create button is visible for admin', async ({ page }) => {
    await page.goto('/projects');
    await expect(
      page.getByRole('link', { name: 'Создать проект' }),
    ).toBeVisible();
  });

  test('archived projects hidden by default', async ({ page }) => {
    await page.goto('/projects?scope=all');
    await expect(page.getByText('Archived').first()).toBeHidden();
  });

  test('show-archived filter reveals archived projects', async ({ page }) => {
    await page.goto('/projects?scope=all');
    // The checkbox has no `htmlFor`/`id` link to its label, so getByLabel can
    // be flaky. Click the wrapping <label> directly via its text.
    await page.getByText('Показать архивные').click();
    await expect(page).toHaveURL(/archived=1/);
    await expect(page.getByText('Archived').first()).toBeVisible();
  });

  test('status filter narrows the list', async ({ page }) => {
    await page.goto('/projects?scope=all');
    await page.locator('select').first().selectOption('ON_HOLD');
    await expect(page.getByText('Проектов пока нет.')).toBeVisible();
  });

  test('scope toggle switches mine/all', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'Все', exact: true }).click();
    await expect(page).toHaveURL(/scope=all/);
  });

  test('clicking project key navigates to overview', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'GFM', exact: true }).first().click();
    await expect(page).toHaveURL(/\/projects\/GFM$/);
  });

  test('Создать проект link opens new project form', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: 'Создать проект' }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
  });

  test('new project key auto-generates from name', async ({ page }) => {
    await page.goto('/projects/new');
    await page.fill('input[name="name"]', 'Brand New Idea');
    // Auto-generated key uses first letters; verify it's filled and uppercase.
    const keyValue = await page.inputValue('input[name="key"]');
    expect(keyValue).toMatch(/^[A-Z]+$/);
    expect(keyValue.length).toBeGreaterThan(0);
  });

  test('create project flow redirects to overview', async ({ page }) => {
    await page.goto('/projects/new');
    await page.fill('input[name="name"]', 'New E2E Project');
    await page.fill('input[name="key"]', 'NEW');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/projects\/NEW$/);
    await expect(page.getByRole('heading', { name: 'New E2E Project' })).toBeVisible();
  });

  test('overview shows Канбан, Задачи, Настройки, +Задача buttons', async ({
    page,
  }) => {
    await page.goto('/projects/GFM');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'Канбан' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Задачи' })).toBeVisible();
    await expect(main.getByRole('link', { name: '+ Задача' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Настройки' })).toBeVisible();
  });

  test('overview Канбан button navigates to board', async ({ page }) => {
    await page.goto('/projects/GFM');
    await page.getByRole('link', { name: 'Канбан' }).click();
    await expect(page).toHaveURL(/\/projects\/GFM\/board/);
  });

  test('overview Задачи button navigates to list', async ({ page }) => {
    await page.goto('/projects/GFM');
    await page.getByRole('link', { name: 'Задачи' }).click();
    await expect(page).toHaveURL(/\/projects\/GFM\/list/);
  });

  test('overview +Задача button navigates to new task', async ({ page }) => {
    await page.goto('/projects/GFM');
    await page.getByRole('link', { name: '+ Задача' }).click();
    await expect(page).toHaveURL(/\/projects\/GFM\/tasks\/new/);
  });

  test('overview Настройки button navigates to settings', async ({ page }) => {
    await page.goto('/projects/GFM');
    await page.locator('main').getByRole('link', { name: 'Настройки' }).click();
    await expect(page).toHaveURL(/\/projects\/GFM\/settings/);
  });

  test('settings page allows editing the name', async ({ page }) => {
    await page.goto('/projects/GFM/settings');
    const input = page.locator('input[name="name"]');
    await expect(input).toBeVisible();
    await input.fill('Giper FM Renamed');
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    await expect(page.getByText('Сохранено')).toBeVisible();
    const projects = await getPrisma().project.findMany({
      where: { key: 'GFM' },
      select: { name: true },
    });
    expect(projects[0]?.name).toBe('Giper FM Renamed');
    // Restore for downstream tests.
    await getPrisma().project.update({
      where: { key: 'GFM' },
      data: { name: 'Giper FM' },
    });
  });

  test('archive button archives the project', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    const proj = await seedProject({
      key: 'ARC',
      name: 'To Archive',
      ownerId: adminId,
    });
    await page.goto('/projects/ARC/settings');
    await page.getByRole('button', { name: 'Архивировать' }).click();
    // Wait for revalidation by reloading
    await page.waitForTimeout(500);
    const after = await getPrisma().project.findUnique({
      where: { id: proj.id },
      select: { status: true },
    });
    expect(after?.status).toBe('ARCHIVED');
  });

  test('non-existent project key returns 404', async ({ page }) => {
    const resp = await page.goto('/projects/NOPE');
    expect(resp?.status()).toBe(404);
  });
});
