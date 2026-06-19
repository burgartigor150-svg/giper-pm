import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, getPrisma } from './fixtures';

test.describe('calendar events', () => {
  let adminId: string;
  // Fixed day so the day-view URL is deterministic (no "today" drift).
  const DAY = '2026-05-20';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
  });

  test('creator deletes a calendar event from the detail dialog', async ({
    page,
  }) => {
    const ev = await getPrisma().calendarEvent.create({
      data: {
        title: 'E2E Событие',
        // Midday UTC keeps the event inside the local day window across TZs.
        startAt: new Date(`${DAY}T12:00:00.000Z`),
        endAt: new Date(`${DAY}T13:00:00.000Z`),
        isAllDay: false,
        createdById: adminId,
      },
    });

    // The delete flow goes through window.confirm — auto-accept it.
    page.on('dialog', (d) => d.accept());

    await page.goto(`/calendar?v=day&d=${DAY}`);
    // Day view lists the event as a clickable chip-button.
    await page.getByRole('button', { name: /E2E Событие/ }).click();
    // Admin is the creator → the dialog shows the delete button.
    await page
      .getByRole('dialog', { name: 'Событие' })
      .getByRole('button', { name: 'Удалить' })
      .click();

    await expect
      .poll(async () =>
        getPrisma().calendarEvent.findUnique({ where: { id: ev.id } }),
      )
      .toBeNull();
  });
});
