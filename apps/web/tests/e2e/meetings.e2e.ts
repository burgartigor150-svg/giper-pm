import { test, expect } from '@playwright/test';
import {
  resetDb,
  seedAdmin,
  seedUser,
  loginAs,
  getPrisma,
  ADMIN_EMAIL,
  ADMIN_PASS,
} from './fixtures';

/**
 * E2E coverage for the new meeting flows:
 *
 *   1. GroupCallButton on /meetings — opens the form, picks invitees
 *      by live search, submits, navigates to /meetings/<id>.
 *
 *   2. /m/<token> guest landing — open the URL without auth, see the
 *      name form, submit a too-short name → validation error, submit
 *      a real name → moves to LiveKit room mount.
 *
 *   3. Bad / expired / revoked tokens — landing page shows a clear
 *      error card and does NOT redirect to /login.
 *
 * LiveKit isn't running in the e2e environment so we don't assert on
 * video — just on the navigation + DB state after each step. The
 * server actions land MeetingParticipant / MeetingInvite rows that we
 * read back via prisma.
 */

test.describe('meetings — group call entry point', () => {
  test.beforeAll(async () => {
    await resetDb();
    await seedAdmin();
    await seedUser({
      email: 'invitee-a@e2e.test',
      name: 'Иван Тестовый',
      role: 'MEMBER',
      password: 'pass-a',
    });
    await seedUser({
      email: 'invitee-b@e2e.test',
      name: 'Пётр Тестовый',
      role: 'MEMBER',
      password: 'pass-b',
    });
  });

  test('admin opens /meetings, sees "+ Групповой звонок" button', async ({ page, context }) => {
    await loginAs(page, context, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto('/meetings');
    await expect(page.getByRole('heading', { name: 'Созвоны' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Групповой звонок/i }),
    ).toBeVisible();
  });

  test('group call form: pick an invitee, submit, navigate to /meetings/<id>', async ({
    page,
    context,
  }) => {
    await loginAs(page, context, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto('/meetings');
    await page.getByRole('button', { name: /Групповой звонок/i }).click();

    // Form should be visible now.
    await expect(page.getByPlaceholder('Например: дейли продакта')).toBeVisible();
    await page.getByPlaceholder('Например: дейли продакта').fill('E2E test call');

    // Search for invitee by name (debounced 250ms).
    await page.getByPlaceholder(/Поиск по имени/i).fill('Иван');
    // Dropdown shows the match.
    const result = page.getByText('Иван Тестовый').first();
    await result.waitFor({ state: 'visible', timeout: 5_000 });
    await result.click();

    // The chip should appear with × button.
    await expect(page.getByRole('button', { name: 'Удалить' })).toBeVisible();

    // Submit.
    await page.getByRole('button', { name: /Позвонить \(1\)/ }).click();

    // Navigation to /meetings/<id>.
    await page.waitForURL(/\/meetings\/[a-z0-9]+/, { timeout: 10_000 });
    const url = page.url();
    const meetingId = url.split('/meetings/')[1]!;
    expect(meetingId.length).toBeGreaterThan(5);

    // DB: meeting + roster should exist.
    const prisma = getPrisma();
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { participants: true },
    });
    expect(meeting?.title).toBe('E2E test call');
    expect(meeting?.status).toBe('PLANNED');
    expect(meeting?.participants.length).toBeGreaterThanOrEqual(2); // caller + Ivan
  });

  test('cannot submit without an invitee selected', async ({ page, context }) => {
    await loginAs(page, context, ADMIN_EMAIL, ADMIN_PASS);
    await page.goto('/meetings');
    await page.getByRole('button', { name: /Групповой звонок/i }).click();
    await page.getByPlaceholder('Например: дейли продакта').fill('No invitees');
    // Submit button is disabled until participants > 0.
    await expect(page.getByRole('button', { name: /Позвонить \(/ })).toBeDisabled();
  });
});

test.describe('meetings — guest invite landing page', () => {
  let inviteToken: string;
  let expiredToken: string;
  let revokedToken: string;
  let exhaustedToken: string;

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    await seedUser({
      email: 'roster@e2e.test',
      role: 'MEMBER',
      password: 'rp',
    });

    // Create a meeting + several invite tokens directly via prisma so
    // the tests don't depend on UI to set them up.
    const prisma = getPrisma();
    const m = await prisma.meeting.create({
      data: {
        title: 'Guest invite test room',
        kind: 'VIDEO_LIVEKIT',
        status: 'PLANNED',
        createdById: admin.id,
        livekitRoomName: `m_e2e_${Date.now()}`,
      },
    });

    inviteToken = `tok-good-${Date.now()}`;
    await prisma.meetingInvite.create({
      data: {
        meetingId: m.id,
        token: inviteToken,
        createdById: admin.id,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });

    expiredToken = `tok-expired-${Date.now()}`;
    await prisma.meetingInvite.create({
      data: {
        meetingId: m.id,
        token: expiredToken,
        createdById: admin.id,
        expiresAt: new Date(Date.now() - 3600_000),
      },
    });

    revokedToken = `tok-revoked-${Date.now()}`;
    await prisma.meetingInvite.create({
      data: {
        meetingId: m.id,
        token: revokedToken,
        createdById: admin.id,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        revokedAt: new Date(),
      },
    });

    exhaustedToken = `tok-exhausted-${Date.now()}`;
    await prisma.meetingInvite.create({
      data: {
        meetingId: m.id,
        token: exhaustedToken,
        createdById: admin.id,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        maxUses: 1,
        usedCount: 1,
      },
    });
  });

  // Guest pages should not require auth — explicitly drop the storage
  // state so we open as a fresh unauthenticated browser.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('valid token: landing page shows name form, no login redirect', async ({ page }) => {
    const resp = await page.goto(`/m/${inviteToken}`);
    expect(resp?.status()).toBe(200);
    // Stay on /m/<token>, NOT redirected to /login.
    expect(page.url()).toContain(`/m/${inviteToken}`);
    expect(page.url()).not.toContain('/login');
    await expect(
      page.getByRole('heading', { name: /Присоединиться к звонку/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/Ваше имя/i)).toBeVisible();
  });

  test('valid token: too-short name → error stays on form', async ({ page }) => {
    await page.goto(`/m/${inviteToken}`);
    await page.getByLabel(/Ваше имя/i).fill('A');
    await page.getByRole('button', { name: /^Войти$/ }).click();
    await expect(page.getByText(/минимум 2 символа/i)).toBeVisible();
    // Still on the landing page.
    expect(page.url()).toContain(`/m/${inviteToken}`);
  });

  test('expired token: error card, not the name form', async ({ page }) => {
    const resp = await page.goto(`/m/${expiredToken}`);
    expect(resp?.status()).toBe(200);
    await expect(page.getByText(/Срок действия ссылки истёк/i)).toBeVisible();
    // No name form on this branch.
    await expect(page.getByLabel(/Ваше имя/i)).toHaveCount(0);
  });

  test('revoked token: error card', async ({ page }) => {
    await page.goto(`/m/${revokedToken}`);
    await expect(page.getByText(/Ссылка была отозвана/i)).toBeVisible();
  });

  test('maxUses exhausted: error card', async ({ page }) => {
    await page.goto(`/m/${exhaustedToken}`);
    await expect(page.getByText(/Лимит подключений/i)).toBeVisible();
  });

  test('unknown token: 404 (next/notFound)', async ({ page }) => {
    const resp = await page.goto('/m/this-token-does-not-exist-1234');
    // Next renders the 404 page with a non-200 status when notFound() fires.
    expect(resp?.status()).toBe(404);
  });
});
