import { test, expect } from '@playwright/test';
import { resetDb, seedAdmin, seedProject, seedTask, getPrisma } from './fixtures';

test.describe('kanban board', () => {
  let adminId: string;
  let projectId: string;
  const PK = 'KAN';

  test.beforeAll(async () => {
    await resetDb();
    const admin = await seedAdmin();
    adminId = admin.id;
    const proj = await seedProject({ key: PK, name: 'Kanban', ownerId: adminId });
    projectId = proj.id;
    // One card per visible column.
    await seedTask({ projectId, creatorId: adminId, title: 'Backlog item', status: 'BACKLOG' });
    await seedTask({ projectId, creatorId: adminId, title: 'Todo item', status: 'TODO' });
    await seedTask({ projectId, creatorId: adminId, title: 'WIP item', status: 'IN_PROGRESS' });
    await seedTask({ projectId, creatorId: adminId, title: 'Review item', status: 'REVIEW' });
    await seedTask({ projectId, creatorId: adminId, title: 'Blocked item', status: 'BLOCKED' });
    await seedTask({ projectId, creatorId: adminId, title: 'Done item', status: 'DONE' });
    await seedTask({ projectId, creatorId: adminId, title: 'Hidden cancel', status: 'CANCELED' });
  });

  test('board renders 6 columns (CANCELED hidden)', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);
    await expect(page.getByText('Бэклог', { exact: true })).toBeVisible();
    await expect(page.getByText('К работе', { exact: true })).toBeVisible();
    await expect(page.getByText('В работе', { exact: true })).toBeVisible();
    await expect(page.getByText('На ревью', { exact: true })).toBeVisible();
    await expect(page.getByText('Заблокирована', { exact: true })).toBeVisible();
    await expect(page.getByText('Готово', { exact: true })).toBeVisible();
    // CANCELED column should not be a header.
    await expect(page.getByText('Отменена', { exact: true })).toHaveCount(0);
  });

  test('cards rendered for each visible column', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);
    await expect(page.getByText('Backlog item')).toBeVisible();
    await expect(page.getByText('Todo item')).toBeVisible();
    await expect(page.getByText('WIP item')).toBeVisible();
    await expect(page.getByText('Review item')).toBeVisible();
    await expect(page.getByText('Blocked item')).toBeVisible();
    await expect(page.getByText('Done item')).toBeVisible();
  });

  test('canceled task is not visible on board', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);
    await expect(page.getByText('Hidden cancel')).toBeHidden();
  });

  test('search filter narrows cards', async ({ page }) => {
    await page.goto(`/projects/${PK}/board?q=WIP`);
    await expect(page.getByText('WIP item')).toBeVisible();
    await expect(page.getByText('Backlog item')).toBeHidden();
  });

  test('priority filter applies via URL', async ({ page }) => {
    await page.goto(`/projects/${PK}/board?priority=URGENT`);
    // No URGENT tasks seeded so all hidden.
    await expect(page.getByText('Backlog item')).toBeHidden();
  });

  test('drag a card across columns updates DB status', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);
    const card = page.getByText('Todo item');
    await expect(card).toBeVisible();

    // Find target column: "Готово" (DONE)
    const target = page.getByText('Готово', { exact: true }).first();
    await card.dragTo(target);
    // Server action takes a moment; allow refresh.
    await page.waitForTimeout(1500);

    const t = await getPrisma().task.findFirst({
      where: { projectId, title: 'Todo item' },
      select: { status: true },
    });
    expect(['DONE', 'TODO']).toContain(t?.status);
    // Soft expect; if dnd kit drag worked status flipped to DONE.
    if (t?.status !== 'DONE') {
      // try moving via simulated pointer events as fallback
      const cardBox = await page.getByText('Todo item').first().boundingBox();
      const targetBox = await target.boundingBox();
      if (cardBox && targetBox) {
        await page.mouse.move(cardBox.x + 5, cardBox.y + 5);
        await page.mouse.down();
        await page.mouse.move(cardBox.x + 50, cardBox.y + 50, { steps: 10 });
        await page.mouse.move(
          targetBox.x + targetBox.width / 2,
          targetBox.y + targetBox.height / 2,
          { steps: 20 },
        );
        await page.mouse.up();
        await page.waitForTimeout(1500);
        const t2 = await getPrisma().task.findFirst({
          where: { projectId, title: 'Todo item' },
          select: { status: true },
        });
        expect(t2?.status).toBe('DONE');
      }
    }
  });

  test('back link via project key chip works', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);
    await page.locator(`a:has-text("${PK}")`).first().click();
    await expect(page).toHaveURL(new RegExp(`/projects/${PK}$`));
  });

  test('only-mine filter applies via URL', async ({ page }) => {
    await page.goto(`/projects/${PK}/board?onlyMine=1`);
    // Tasks are unassigned so list should be empty.
    await expect(page.getByText('Todo item')).toBeHidden();
  });
});
