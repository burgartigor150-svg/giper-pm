import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, seedTask, getPrisma } from './fixtures';

test.describe('dashboard', () => {
  let adminId: string;

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const proj = await seedProject({ key: 'GFM', name: 'Giper FM', ownerId: adminId });
    // In-progress task assigned to admin
    await seedTask({
      projectId: proj.id,
      creatorId: adminId,
      assigneeId: adminId,
      status: 'IN_PROGRESS',
      title: 'Active task',
    });
    // Overdue task assigned to admin
    const prisma = getPrisma();
    await prisma.task.create({
      data: {
        projectId: proj.id,
        number: 2,
        title: 'Overdue task',
        creatorId: adminId,
        assigneeId: adminId,
        status: 'TODO',
        dueDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    // Due-today task
    const today = new Date();
    today.setHours(23, 59, 59, 0);
    await prisma.task.create({
      data: {
        projectId: proj.id,
        number: 3,
        title: 'Due today task',
        creatorId: adminId,
        assigneeId: adminId,
        status: 'TODO',
        dueDate: today,
      },
    });
  });

  test('greets the user', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Admin E2E');
  });

  test('renders Today total card', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Часов сегодня')).toBeVisible();
  });

  test('renders In-progress section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Мои задачи в работе')).toBeVisible();
  });

  test('renders Due today section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Сегодня дедлайн')).toBeVisible();
  });

  test('renders Overdue section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Просрочено')).toBeVisible();
  });

  test('renders 7-day chart section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('За последние 7 дней')).toBeVisible();
  });

  test('shows in-progress task in section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Active task').first()).toBeVisible();
  });

  test('shows overdue task in section', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('Overdue task').first()).toBeVisible();
  });

  test('topbar visible with timer widget', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('header').first()).toBeVisible();
    // Either the start picker button (sm: hidden) or the running widget exists.
    await expect(page.getByRole('button', { name: /Старт/i })).toBeVisible();
  });

  test('sidebar visible with all admin nav items', async ({ page }) => {
    await page.goto('/dashboard');
    const aside = page.locator('aside');
    await expect(aside.getByRole('link', { name: 'Дашборд' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Проекты' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Время' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Команда' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Отчёты' })).toBeVisible();
    await expect(aside.getByRole('link', { name: 'Настройки' })).toBeVisible();
  });
});
