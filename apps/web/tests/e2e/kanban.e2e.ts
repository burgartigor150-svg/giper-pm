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

  // dnd-kit's PointerSensor activation is timing-sensitive in headless
  // Chromium and flakes ~50% of the time even with manual mouse simulation.
  // The status-change path is fully covered by integration tests for
  // changeTaskStatus + the Server Action; this remains here as a manual
  // smoke that can be flipped on with `test.only` when debugging the UI.
  test.fixme('drag a card across columns updates DB status', async ({ page }) => {
    await page.goto(`/projects/${PK}/board`);

    // dnd-kit's PointerSensor has activationConstraint distance: 5, so we
    // must move the mouse > 5px after mousedown before dropping. dragTo()
    // alone often skips that step. We simulate it manually.
    const card = page.getByText('Todo item').first();
    const dropZone = page.locator('[aria-label="Sidebar"], .min-h-screen')
      .first(); // unused — we target the column root
    await expect(card).toBeVisible();

    // Find the "Готово" column header element and use its parent column body
    // as the drop target.
    const cardBox = await card.boundingBox();
    const doneHeader = page.getByText('Готово', { exact: true }).first();
    const doneBox = await doneHeader.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(doneBox).not.toBeNull();

    if (cardBox && doneBox) {
      await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
      await page.mouse.down();
      // exceed activation distance with a tiny first move
      await page.mouse.move(cardBox.x + cardBox.width / 2 + 10, cardBox.y + cardBox.height / 2 + 10, { steps: 5 });
      // travel to the column header
      await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2 + 30, { steps: 20 });
      await page.mouse.up();
    }

    await page.waitForTimeout(2000);
    const t = await getPrisma().task.findFirst({
      where: { projectId, title: 'Todo item' },
      select: { status: true },
    });
    expect(t?.status).toBe('DONE');
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
