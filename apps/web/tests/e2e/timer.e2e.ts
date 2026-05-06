import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, seedTask, getPrisma } from './fixtures';

test.describe('timers', () => {
  let adminId: string;
  let projectId: string;
  const PK = 'TMR';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const proj = await seedProject({ key: PK, name: 'Timer Project', ownerId: adminId });
    projectId = proj.id;
    await seedTask({ projectId, creatorId: adminId, title: 'Timer Alpha', status: 'TODO' });
    await seedTask({ projectId, creatorId: adminId, title: 'Timer Beta', status: 'TODO' });
  });

  test.afterEach(async () => {
    // Stop any active timer to keep tests independent.
    await getPrisma().timeEntry.updateMany({
      where: { userId: adminId, endedAt: null },
      data: { endedAt: new Date(), durationMin: 1 },
    });
  });

  test('TaskTimerButton starts a timer on the task', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(800);
    const t = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
      include: { task: true },
    });
    expect(t).not.toBeNull();
    expect(t?.task?.title).toBe('Timer Alpha');
  });

  test('header widget shows live counter once timer is running', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(1500);
    // Now header widget should show a Pause button.
    await expect(page.locator('header').getByRole('button').filter({
      has: page.locator('svg'),
    }).first()).toBeVisible();
    // The TaskTimerButton in header switches to "Стоп"
    await expect(page.getByRole('button', { name: /Стоп/ }).first()).toBeVisible();
  });

  test('Stop button on task ends timer in DB', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: /Стоп/ }).first().click();
    await page.waitForTimeout(800);
    const active = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
    });
    expect(active).toBeNull();
  });

  test('switch task with confirm dialog accepted', async ({ page }) => {
    // Start on Alpha
    await page.goto(`/projects/${PK}/tasks/1`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(800);

    // Switch to Beta. There may be a confirm in TaskTimerButton.
    page.on('dialog', (d) => d.accept());
    await page.goto(`/projects/${PK}/tasks/2`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(1500);
    const t = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
      include: { task: true },
    });
    expect(t?.task?.title).toBe('Timer Beta');
  });

  test('TimerWidget Start picker opens with debounced search', async ({ page }) => {
    await page.goto('/dashboard');
    // Header start button
    await page.locator('header').getByRole('button', { name: /Старт/ }).click();
    const input = page.getByPlaceholder('Введите название задачи');
    await expect(input).toBeVisible();
    await input.fill('Ti');
    // Debounce fires at 250ms; result Timer Alpha should appear.
    await expect(
      page.getByText('Timer Alpha', { exact: false }).first(),
    ).toBeVisible({ timeout: 5000 });
  });

  test('TimerWidget picker minimum 2 chars message', async ({ page }) => {
    await page.goto('/dashboard');
    await page.locator('header').getByRole('button', { name: /Старт/ }).click();
    await expect(page.getByText('Минимум 2 символа')).toBeVisible();
  });

  test('Stop via header widget ends timer', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await page.getByRole('button', { name: /Старт/ }).click();
    await page.waitForTimeout(1500);
    // Find header widget pause button (variant=destructive icon with no label "Стоп" on header)
    const headerStop = page.locator('header').getByRole('button').filter({
      has: page.locator('svg'),
    });
    // Click whichever has Pause icon (last destructive in header).
    // Simpler: navigate to dashboard so only widget is rendered.
    await page.goto('/dashboard');
    await page.locator('header [aria-label="Стоп"]').click();
    await page.waitForTimeout(800);
    const active = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
    });
    expect(active).toBeNull();
  });
});
