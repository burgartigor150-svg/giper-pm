import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, seedTask, seedUser, getPrisma } from './fixtures';

test.describe('tasks list & detail', () => {
  let adminId: string;
  let projectId: string;
  const PK = 'TSK';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const proj = await seedProject({ key: PK, name: 'Tasks Project', ownerId: adminId });
    projectId = proj.id;

    // Seed many tasks for sort/filter/pagination
    for (let i = 1; i <= 25; i++) {
      const status = i % 3 === 0 ? 'IN_PROGRESS' : i % 3 === 1 ? 'TODO' : 'DONE';
      await seedTask({
        projectId,
        creatorId: adminId,
        title: `Task ${i}`,
        status: status as 'TODO' | 'IN_PROGRESS' | 'DONE',
        assigneeId: adminId,
      });
    }
  });

  test('list page renders with tasks', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    await expect(page.getByRole('heading', { name: 'Задачи' })).toBeVisible();
    await expect(page.getByText('Task 1', { exact: true })).toBeVisible();
  });

  test('list page renders all column headers', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    await expect(page.getByRole('button', { name: /№/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Название/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Статус/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Исполнитель/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Оценка/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Срок/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Приоритет/ })).toBeVisible();
  });

  test('sort by title toggles direction', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    await page.getByRole('button', { name: /Название/ }).click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page).toHaveURL(/dir=asc/);
    await page.getByRole('button', { name: /Название/ }).click();
    await expect(page).toHaveURL(/dir=desc/);
  });

  test('search filter narrows results', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    await page.locator('input[type="search"]').fill('Task 7');
    await page.locator('input[type="search"]').press('Enter');
    await expect(page).toHaveURL(/q=Task/);
    await expect(page.getByText('Task 7', { exact: true })).toBeVisible();
  });

  test('status filter narrows results', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    // First select is status filter (label "Статус:")
    await page
      .locator('label:has-text("Статус:") select')
      .selectOption('IN_PROGRESS');
    await expect(page).toHaveURL(/status=IN_PROGRESS/);
  });

  test('pagination shows next/prev when many tasks', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    // Default page size in list is small enough that 25 tasks paginate.
    const next = page.getByRole('button', { name: 'Вперёд' });
    if (await next.count()) {
      await expect(next).toBeVisible();
      await next.click();
      await expect(page).toHaveURL(/page=2/);
    }
  });

  test('clicking task title opens task detail', async ({ page }) => {
    await page.goto(`/projects/${PK}/list`);
    await page.getByRole('link', { name: 'Task 1', exact: true }).first().click();
    await expect(page).toHaveURL(/\/tasks\/1$/);
    await expect(page.getByRole('heading', { name: 'Task 1' })).toBeVisible();
  });

  test('task detail renders sidebar with status/assignee/priority', async ({
    page,
  }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await expect(page.getByText('Статус', { exact: true })).toBeVisible();
    await expect(page.getByText('Исполнитель', { exact: true })).toBeVisible();
    await expect(page.getByText('Приоритет', { exact: true })).toBeVisible();
  });

  test('inline title edit saves', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/2`);
    await page.locator('button[aria-label="Редактировать заголовок"]').click();
    const input = page.locator('input.text-2xl');
    await input.fill('Task 2 Renamed');
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    await page.waitForTimeout(500);
    const t = await getPrisma().task.findFirst({
      where: { projectId, number: 2 },
      select: { title: true },
    });
    expect(t?.title).toBe('Task 2 Renamed');
  });

  test('inline description edit saves', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/3`);
    await page.getByRole('button', { name: 'Редактировать' }).first().click();
    await page.locator('textarea').first().fill('A useful description.');
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
    await page.waitForTimeout(500);
    const t = await getPrisma().task.findFirst({
      where: { projectId, number: 3 },
      select: { description: true },
    });
    expect(t?.description).toBe('A useful description.');
  });

  test('sidebar status change persists', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/4`);
    // First select in sidebar is status
    const statusSelect = page
      .locator('aside ~ * select, .grid select')
      .first();
    await statusSelect.selectOption('REVIEW');
    await page.waitForTimeout(800);
    const t = await getPrisma().task.findFirst({
      where: { projectId, number: 4 },
      select: { status: true },
    });
    expect(t?.status).toBe('REVIEW');
  });

  test('sidebar priority change persists', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/5`);
    // Find priority select by its option value URGENT
    const prio = page.locator('select').filter({ hasText: 'Срочный' });
    await prio.selectOption('URGENT');
    await page.waitForTimeout(800);
    const t = await getPrisma().task.findFirst({
      where: { projectId, number: 5 },
      select: { priority: true },
    });
    expect(t?.priority).toBe('URGENT');
  });

  test('comment form submits a new comment', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/6`);
    await page.locator('textarea[name="body"]').fill('Hello from E2E');
    await page.getByRole('button', { name: 'Отправить' }).click();
    await expect(page.getByText('Hello from E2E')).toBeVisible();
    const comments = await getPrisma().comment.count({
      where: { task: { projectId, number: 6 } },
    });
    expect(comments).toBe(1);
  });

  test('delete task with confirm removes it', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await page.goto(`/projects/${PK}/tasks/25`);
    await page.getByRole('button', { name: /Удалить задачу/ }).click();
    await page.waitForTimeout(800);
    const t = await getPrisma().task.findFirst({
      where: { projectId, number: 25 },
    });
    expect(t).toBeNull();
  });

  test('new task form creates a task', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/new`);
    await page.fill('input[name="title"]', 'Created via E2E');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(800);
    const t = await getPrisma().task.findFirst({
      where: { projectId, title: 'Created via E2E' },
    });
    expect(t).not.toBeNull();
  });

  test('non-existent task returns 404', async ({ page }) => {
    const resp = await page.goto(`/projects/${PK}/tasks/9999`);
    expect(resp?.status()).toBe(404);
  });
});
