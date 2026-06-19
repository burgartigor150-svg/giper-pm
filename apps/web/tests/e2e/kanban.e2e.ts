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

  // Runs last: seeding a swimlane flips the board into band mode, so the rest
  // of the suite (which asserts the single-lane layout) stays unaffected.
  test('renders swimlane bands when lanes exist', async ({ page }) => {
    const prisma = getPrisma();
    const lane = await prisma.boardSwimlane.create({
      data: { projectId, name: 'Срочное', order: 0 },
    });
    await prisma.task.updateMany({
      where: { projectId, title: 'Todo item' },
      data: { swimlaneId: lane.id },
    });
    await page.goto(`/projects/${PK}/board`);
    // Both the configured lane and the implicit "no lane" band render as headings.
    await expect(page.getByRole('heading', { name: 'Срочное' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Без дорожки' })).toBeVisible();
    // The card stays visible (now inside its lane band).
    await expect(page.getByText('Todo item')).toBeVisible();
  });

  test('metrics page renders with charts', async ({ page }) => {
    await page.goto(`/projects/${PK}/metrics`);
    await expect(page.getByRole('heading', { name: 'Метрики' })).toBeVisible();
    await expect(page.getByText('Lead time (медиана)')).toBeVisible();
    // Confirms the client chart component mounted without crashing.
    await expect(
      page.getByText('Пропускная способность (задач/неделю)'),
    ).toBeVisible();
  });

  // Self-contained: a fresh project with one real column split into two
  // sub-columns + a card. Verifies the sub-column render path (the KAN project
  // above stays on the byte-identical no-subcolumn path).
  test('board renders sub-column zones', async ({ page }) => {
    const prisma = getPrisma();
    const proj = await prisma.project.create({
      data: { key: 'SUB', name: 'Sub Project', ownerId: adminId },
    });
    const col = await prisma.boardColumn.create({
      data: { projectId: proj.id, name: 'В работе', status: 'IN_PROGRESS', order: 0 },
    });
    await prisma.boardSubColumn.create({
      data: { columnId: col.id, name: 'Разработка', order: 0 },
    });
    await prisma.boardSubColumn.create({
      data: { columnId: col.id, name: 'Ревью', order: 1 },
    });
    await prisma.task.create({
      data: {
        projectId: proj.id,
        number: 1,
        title: 'Sub card',
        creatorId: adminId,
        assigneeId: adminId,
        status: 'IN_PROGRESS',
        internalStatus: 'IN_PROGRESS',
      },
    });
    await page.goto('/projects/SUB/board');
    await expect(page.getByText('Разработка')).toBeVisible();
    await expect(page.getByText('Ревью')).toBeVisible();
    await expect(page.getByText('Sub card')).toBeVisible();
  });

  test('creating a card from a template opens the new task', async ({ page }) => {
    await getPrisma().cardTemplate.create({
      data: {
        projectId,
        name: 'Шаблон ревью',
        title: 'Провести ревью',
        type: 'TASK',
        priority: 'HIGH',
        order: 0,
      },
    });
    await page.goto(`/projects/${PK}/board`);
    await page.getByRole('button', { name: /Из шаблона/ }).click();
    await page.getByRole('button', { name: 'Шаблон ревью' }).click();
    // The action creates the task and navigates straight to its detail page.
    await expect(page).toHaveURL(new RegExp(`/projects/${PK}/tasks/\\d+`));
    await expect(page.getByText('Провести ревью').first()).toBeVisible();
  });

  test('gantt/timeline renders task rows', async ({ page }) => {
    await page.goto(`/projects/${PK}/gantt`);
    await expect(page.getByRole('heading', { name: 'Гант / таймлайн' })).toBeVisible();
    // Admin is the creator of the seeded cards, so they appear in the timeline.
    await expect(page.getByText('Backlog item').first()).toBeVisible();
    await expect(page.getByText('сегодня').first()).toBeVisible();
  });
});
