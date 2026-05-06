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

  /** TaskTimerButton lives inside <main>, the TimerWidget lives inside <header>.
   *  Two visible "Старт" buttons → scope every selector explicitly. */
  const mainStart = (page: import('@playwright/test').Page) =>
    page.locator('main').getByRole('button', { name: /Старт/ });
  const mainStop = (page: import('@playwright/test').Page) =>
    page.locator('main').getByRole('button', { name: /Стоп/ });

  test('TaskTimerButton starts a timer on the task', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await mainStart(page).click();
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
    await mainStart(page).click();
    await page.waitForTimeout(1500);
    // Header widget shows a MM:SS counter (font-mono span). Just look for the digits.
    const headerText = await page.locator('header').innerText();
    expect(headerText).toMatch(/\d{1,2}:\d{2}/);
    // Both task button and header widget show "Стоп" or its icon.
    await expect(mainStop(page)).toBeVisible();
  });

  test('Stop button on task ends timer in DB', async ({ page }) => {
    await page.goto(`/projects/${PK}/tasks/1`);
    await mainStart(page).click();
    await page.waitForTimeout(800);
    await mainStop(page).click();
    await page.waitForTimeout(800);
    const active = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
    });
    expect(active).toBeNull();
  });

  test('switch task with confirm dialog accepted', async ({ page }) => {
    // Start on Alpha
    page.on('dialog', (d) => d.accept());
    await page.goto(`/projects/${PK}/tasks/1`);
    await mainStart(page).click();
    await page.waitForTimeout(800);

    // Open Beta — TaskTimerButton on Beta will detect "running on another task"
    // and show confirm() before starting.
    await page.goto(`/projects/${PK}/tasks/2`);
    await mainStart(page).click();
    await page.waitForTimeout(1500);
    const t = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
      include: { task: true },
    });
    expect(t?.task?.title).toBe('Timer Beta');
  });

  test('TimerWidget Start picker opens with debounced search', async ({ page }) => {
    await page.goto('/dashboard');
    // Header start button (only one inside header when no active timer).
    await page.locator('header').getByRole('button', { name: /Старт/ }).click();
    const input = page.getByPlaceholder('Введите название задачи');
    await expect(input).toBeVisible();
    await input.fill('Ti');
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
    await mainStart(page).click();
    await page.waitForTimeout(1500);

    // Click the header widget's pause button. It has aria-label="Стоп".
    await page.locator('header [aria-label="Стоп"]').click();
    await page.waitForTimeout(800);
    const active = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, endedAt: null },
    });
    expect(active).toBeNull();
  });
});
