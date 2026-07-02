import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMe = {
  id: '',
  role: 'MEMBER' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
  name: 'A',
  email: 'a@a',
  image: null,
  mustChangePassword: false,
};

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => mockMe),
  requireRole: vi.fn(async () => mockMe),
  signOut: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { toggleChecklistItemAction } from '@/actions/checklists';
import { prisma } from '@giper/db';
import { makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'MEMBER';
});

async function mirrorTaskWithChecklistItem(creatorId: string) {
  const owner = await makeUser();
  const project = await makeProject({ ownerId: owner.id, key: 'CL' });
  await prisma.project.update({
    where: { id: project.id },
    data: { externalSource: 'bitrix24', externalId: `wg-${project.id}` },
  });
  const task = await makeTask({ projectId: project.id, creatorId });
  const checklist = await prisma.checklist.create({ data: { taskId: task.id } });
  const item = await prisma.checklistItem.create({
    data: { checklistId: checklist.id, body: 'Пункт' },
  });
  return { project, task, item };
}

describe('toggleChecklistItemAction — any task viewer may tick', () => {
  it('a watcher (no membership) can toggle a checklist item on a mirror task', async () => {
    const owner = await makeUser();
    const watcher = await makeUser({ role: 'MEMBER' });
    const { project, task, item } = await mirrorTaskWithChecklistItem(owner.id);
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: watcher.id } });
    mockMe.id = watcher.id;

    const res = await toggleChecklistItemAction(item.id, project.key, 1, true);
    expect(res).toEqual({ ok: true });
    const after = await prisma.checklistItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.isDone).toBe(true);
    expect(after.doneById).toBe(watcher.id);
  });

  it('a user with no stake and no membership cannot toggle', async () => {
    const owner = await makeUser();
    const stranger = await makeUser({ role: 'MEMBER' });
    const { project, item } = await mirrorTaskWithChecklistItem(owner.id);
    mockMe.id = stranger.id;

    const res = await toggleChecklistItemAction(item.id, project.key, 1, true);
    expect(res).toEqual({
      ok: false,
      error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Нет доступа' },
    });
  });
});
