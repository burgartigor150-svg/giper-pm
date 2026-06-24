import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for the in-board swimlane management actions (S8): create,
 * rename, drag-reorder — the instant-persist server actions the kanban board
 * calls for inline lane editing. Source: apps/web/actions/board.ts.
 */

const mockMe = {
  id: '',
  role: 'ADMIN' as 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER',
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

import { prisma } from '@giper/db';
import {
  createBoardSwimlaneAction,
  renameBoardSwimlaneAction,
  reorderBoardSwimlanesAction,
} from '@/actions/board';
import { makeUser, makeProject } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

async function lanesOf(projectId: string) {
  return prisma.boardSwimlane.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
}

describe('board swimlanes — inline management', () => {
  it('creates lanes with incrementing order', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });

    const a = await createBoardSwimlaneAction(project.id, 'Срочное');
    const b = await createBoardSwimlaneAction(project.id, 'Обычное');
    expect(a.ok && b.ok).toBe(true);

    const lanes = await lanesOf(project.id);
    expect(lanes.map((l) => l.name)).toEqual(['Срочное', 'Обычное']);
    expect(lanes.map((l) => l.order)).toEqual([0, 1]);
  });

  it('rejects an empty lane name', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const res = await createBoardSwimlaneAction(project.id, '   ');
    expect(res.ok).toBe(false);
  });

  it('renames a lane', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const created = await createBoardSwimlaneAction(project.id, 'Старое');
    const id = created.ok ? created.data!.id : '';

    expect((await renameBoardSwimlaneAction(id, 'Новое')).ok).toBe(true);
    expect((await prisma.boardSwimlane.findUniqueOrThrow({ where: { id } })).name).toBe('Новое');
  });

  it('drag-reorder persists the new order and ignores foreign ids', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id });
    const ids: string[] = [];
    for (const n of ['A', 'B', 'C']) {
      const r = await createBoardSwimlaneAction(project.id, n);
      ids.push(r.ok ? r.data!.id : '');
    }
    // Move C to the front (what the board's onDragEnd sends), plus a foreign id.
    const reordered = [ids[2], ids[0], ids[1], 'foreign-id-not-in-project'] as string[];
    expect((await reorderBoardSwimlanesAction(project.id, reordered)).ok).toBe(true);

    const lanes = await lanesOf(project.id);
    expect(lanes.map((l) => l.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('forbids a MEMBER who cannot edit the project', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const project = await makeProject({ ownerId: owner.id });
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    mockMe.role = 'MEMBER';

    const res = await createBoardSwimlaneAction(project.id, 'Нельзя');
    expect(res.ok).toBe(false);
    expect(await lanesOf(project.id)).toHaveLength(0);
  });
});
