import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, seedTask, getPrisma } from './fixtures';

test.describe('time tracking page', () => {
  let adminId: string;
  let projectId: string;
  const PK = 'TIM';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const proj = await seedProject({ key: PK, name: 'Time', ownerId: adminId });
    projectId = proj.id;
    const t = await seedTask({ projectId, creatorId: adminId, title: 'Loggable', status: 'TODO' });

    // One closed entry today.
    const start = new Date();
    start.setHours(9, 0, 0, 0);
    const end = new Date();
    end.setHours(10, 0, 0, 0);
    await getPrisma().timeEntry.create({
      data: {
        userId: adminId,
        taskId: t.id,
        startedAt: start,
        endedAt: end,
        durationMin: 60,
        source: 'MANUAL_FORM',
        note: 'Existing entry',
      },
    });
  });

  test('time page renders title and entry', async ({ page }) => {
    await page.goto('/time');
    await expect(page.getByRole('heading', { name: 'Моё время' })).toBeVisible();
    await expect(page.getByText('Existing entry')).toBeVisible();
  });

  test('range tab Сегодня is selected by default', async ({ page }) => {
    await page.goto('/time');
    const tab = page.getByRole('button', { name: 'Сегодня' });
    await expect(tab).toHaveClass(/bg-primary/);
  });

  test('range tab Эта неделя navigates with range param', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: 'Эта неделя' }).click();
    await expect(page).toHaveURL(/range=week/);
  });

  test('range tab Месяц navigates with range param', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: 'Месяц' }).click();
    await expect(page).toHaveURL(/range=month/);
  });

  test('range tab Период reveals from/to inputs', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: 'Период' }).click();
    await expect(page).toHaveURL(/range=custom/);
    await expect(page.locator('input[type="date"]').first()).toBeVisible();
  });

  test('Добавить вручную toggles ManualTimeForm', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: /Добавить вручную/ }).click();
    await expect(page.locator('input[name="date"]')).toBeVisible();
    await expect(page.locator('input[name="startTime"]')).toBeVisible();
    await expect(page.locator('input[name="endTime"]')).toBeVisible();
  });

  test('manual entry submit creates a TimeEntry', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: /Добавить вручную/ }).click();
    // date is prefilled with today
    await page.fill('input[name="startTime"]', '14:00');
    await page.fill('input[name="endTime"]', '15:00');
    await page.fill('textarea[name="note"]', 'E2E manual');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await page.waitForTimeout(1500);
    const entry = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, note: 'E2E manual' },
    });
    expect(entry).not.toBeNull();
  });

  test('overlap warning shows when overlapping with existing', async ({ page }) => {
    await page.goto('/time');
    await page.getByRole('button', { name: /Добавить вручную/ }).click();
    await page.fill('input[name="startTime"]', '09:30');
    await page.fill('input[name="endTime"]', '09:45');
    await page.fill('textarea[name="note"]', 'overlap test');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await expect(
      page.getByText('Запись пересекается с другой и помечена флагом «Пересечение».'),
    ).toBeVisible({ timeout: 5000 });
  });

  test('edit pencil link opens edit page', async ({ page }) => {
    await page.goto('/time');
    await page.locator('a[href*="/time/"][href*="/edit"]').first().click();
    await expect(page).toHaveURL(/\/time\/.+\/edit$/);
    await expect(page.getByText('Редактировать запись')).toBeVisible();
  });

  test('edit time entry updates note', async ({ page }) => {
    const entry = await getPrisma().timeEntry.findFirst({
      where: { userId: adminId, note: 'Existing entry' },
    });
    expect(entry).not.toBeNull();
    await page.goto(`/time/${entry!.id}/edit`);
    await page.fill('textarea[name="note"]', 'Edited note');
    await page.getByRole('button', { name: 'Сохранить' }).click();
    await page.waitForTimeout(1000);
    const after = await getPrisma().timeEntry.findUnique({
      where: { id: entry!.id },
      select: { note: true },
    });
    expect(after?.note).toBe('Edited note');
  });

  test('delete entry with confirm removes it', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    // Create a throwaway entry first
    const fresh = await getPrisma().timeEntry.create({
      data: {
        userId: adminId,
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        endedAt: new Date(),
        durationMin: 30,
        source: 'MANUAL_FORM',
        note: 'to-delete',
      },
    });
    await page.goto('/time');
    // Click the trash button on the row containing "to-delete"
    const row = page
      .locator('tr')
      .filter({ has: page.getByText('to-delete') });
    await row.locator('button[aria-label="Удалить"]').click();
    await page.waitForTimeout(1000);
    const after = await getPrisma().timeEntry.findUnique({ where: { id: fresh.id } });
    expect(after).toBeNull();
  });

  test('total hours card visible', async ({ page }) => {
    await page.goto('/time');
    await expect(page.getByText('Всего часов')).toBeVisible();
  });

  test('non-existent entry edit returns 404', async ({ page }) => {
    const resp = await page.goto('/time/no-such-id/edit');
    expect(resp?.status()).toBe(404);
  });
});
