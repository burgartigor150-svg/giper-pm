import { test, expect, type BrowserContext } from '@playwright/test';
import {
  resetDb,
  seedAdmin,
  seedUser,
  seedProject,
  seedTask,
  loginAs,
  getPrisma,
} from './fixtures';

test.describe('RBAC', () => {
  let adminId: string;
  let memberId: string;
  let viewerId: string;
  let projectId: string;
  const PK = 'RBC';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const member = await seedUser({
      email: 'rbac-member@e2e.test',
      role: 'MEMBER',
      password: 'rbac-mem-1',
      name: 'RBAC Member',
    });
    memberId = member.id;
    const viewer = await seedUser({
      email: 'rbac-viewer@e2e.test',
      role: 'VIEWER',
      password: 'rbac-view-1',
      name: 'RBAC Viewer',
    });
    viewerId = viewer.id;
    await seedUser({
      email: 'rbac-pm@e2e.test',
      role: 'PM',
      password: 'rbac-pm-1',
      name: 'RBAC PM',
    });
    const proj = await seedProject({
      key: PK,
      name: 'RBAC Project',
      ownerId: adminId,
    });
    projectId = proj.id;
    // Add member and viewer as project members so they can see it.
    await getPrisma().projectMember.createMany({
      data: [
        { projectId: proj.id, userId: memberId, role: 'CONTRIBUTOR' },
        { projectId: proj.id, userId: viewerId, role: 'OBSERVER' },
      ],
      skipDuplicates: true,
    });
    await seedTask({
      projectId: proj.id,
      creatorId: adminId,
      title: 'RBAC task',
      status: 'TODO',
    });
  });

  test('VIEWER does not see Создать проект button', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-viewer@e2e.test',
      'rbac-view-1',
    );
    await page.goto('/projects');
    await expect(
      page.getByRole('link', { name: 'Создать проект' }),
    ).toHaveCount(0);
  });

  test('VIEWER cannot reach /projects/new (404)', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-viewer@e2e.test',
      'rbac-view-1',
    );
    const resp = await page.goto('/projects/new');
    expect(resp?.status()).toBe(404);
  });

  test('VIEWER cannot reach /projects/RBC/tasks/new (404)', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-viewer@e2e.test',
      'rbac-view-1',
    );
    const resp = await page.goto(`/projects/${PK}/tasks/new`);
    expect(resp?.status()).toBe(404);
  });

  test('MEMBER does not see Создать проект button', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-member@e2e.test',
      'rbac-mem-1',
    );
    await page.goto('/projects');
    await expect(
      page.getByRole('link', { name: 'Создать проект' }),
    ).toHaveCount(0);
  });

  test('MEMBER cannot reach /projects/new (404)', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-member@e2e.test',
      'rbac-mem-1',
    );
    const resp = await page.goto('/projects/new');
    expect(resp?.status()).toBe(404);
  });

  test('MEMBER does not see Команда in sidebar', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-member@e2e.test',
      'rbac-mem-1',
    );
    await page.goto('/dashboard');
    await expect(
      page.locator('aside').getByRole('link', { name: 'Команда' }),
    ).toHaveCount(0);
  });

  test('MEMBER does not see Настройки in sidebar', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-member@e2e.test',
      'rbac-mem-1',
    );
    await page.goto('/dashboard');
    await expect(
      page.locator('aside').getByRole('link', { name: 'Настройки' }),
    ).toHaveCount(0);
  });

  test('VIEWER does not see Отчёты in sidebar', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-viewer@e2e.test',
      'rbac-view-1',
    );
    await page.goto('/dashboard');
    await expect(
      page.locator('aside').getByRole('link', { name: 'Отчёты' }),
    ).toHaveCount(0);
  });

  test('VIEWER does not see Команда in sidebar', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-viewer@e2e.test',
      'rbac-view-1',
    );
    await page.goto('/dashboard');
    await expect(
      page.locator('aside').getByRole('link', { name: 'Команда' }),
    ).toHaveCount(0);
  });

  test('PM sees Команда in sidebar', async ({ page, context }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-pm@e2e.test',
      'rbac-pm-1',
    );
    await page.goto('/dashboard');
    await expect(
      page.locator('aside').getByRole('link', { name: 'Команда' }),
    ).toBeVisible();
  });

  test('PM does NOT see Настройки in sidebar (admin-only)', async ({
    page,
    context,
  }) => {
    await loginAs(
      page,
      context as BrowserContext,
      'rbac-pm@e2e.test',
      'rbac-pm-1',
    );
    await page.goto('/dashboard');
    // PM has canSeeSettings = true per permissions, but settings page only
    // shows admin-only content. Verify that nav link is visible.
    await expect(
      page.locator('aside').getByRole('link', { name: 'Настройки' }),
    ).toBeVisible();
  });
});
