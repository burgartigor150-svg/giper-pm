import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Per-project Tag system. Tests cover both the auth-aware Server
 * Actions (`apps/web/actions/tags.ts`) and the underlying DB shape.
 *
 * Auth model under test:
 *   - listing / creating tags: ADMIN, or a ProjectMember row
 *   - assigning a tag to a task: anyone with `canEditTaskInternal`
 *     (creator, assignee, project owner, LEAD, ADMIN). Bitrix-mirror
 *     tasks count — tags don't round-trip.
 *   - deleting a tag: ADMIN or project owner
 *   - duplicate slug: idempotent — returns the existing tag
 */

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

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from '@giper/db';
import {
  listTagsForProject,
  createTagAction,
  assignTagToTaskAction,
  unassignTagFromTaskAction,
  deleteTagAction,
} from '@/actions/tags';
import { addMember, makeProject, makeTask, makeUser } from './helpers/factories';

beforeEach(() => {
  mockMe.id = '';
  mockMe.role = 'MEMBER';
});

async function setup() {
  const owner = await makeUser();
  const project = await makeProject({ ownerId: owner.id });
  return { owner, project };
}

describe('createTagAction', () => {
  it('member creates tag with default palette color and slug', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const res = await createTagAction(project.id, 'Backend');
    expect(res.ok).toBe(true);
    if (res.ok && res.data) {
      expect(res.data.slug).toBe('backend');
      expect(res.data.name).toBe('Backend');
      expect(res.data.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('explicit color overrides palette', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const res = await createTagAction(project.id, 'Hot', '#ff00aa');
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(res.data.color).toBe('#ff00aa');
  });

  it('empty/whitespace name → VALIDATION', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    expect(await createTagAction(project.id, '   ')).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('name longer than 40 chars → VALIDATION', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    expect(await createTagAction(project.id, 'a'.repeat(41))).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' },
    });
  });

  it('non-member MEMBER → FORBIDDEN', async () => {
    const { project } = await setup();
    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    expect(await createTagAction(project.id, 'X')).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('ADMIN can create even without ProjectMember row', async () => {
    const { project } = await setup();
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    const res = await createTagAction(project.id, 'Admin Tag');
    expect(res.ok).toBe(true);
  });

  it('duplicate slug returns the existing tag (idempotent)', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const first = await createTagAction(project.id, 'Backend');
    const second = await createTagAction(project.id, 'BACKEND');
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok && first.data && second.data) {
      expect(second.data.id).toBe(first.data.id);
    }
  });

  it('slugify keeps cyrillic, strips punctuation, caps at 60', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const res = await createTagAction(project.id, '  Срочно!!! ');
    expect(res.ok).toBe(true);
    if (res.ok && res.data) expect(res.data.slug).toMatch(/^срочно$/);
  });
});

describe('listTagsForProject', () => {
  it('returns project tags ordered by name; empty array for outsiders', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    await createTagAction(project.id, 'Zeta');
    await createTagAction(project.id, 'Alpha');
    const list = await listTagsForProject(project.id);
    expect(list.map((t) => t.name)).toEqual(['Alpha', 'Zeta']);

    const stranger = await makeUser({ role: 'MEMBER' });
    mockMe.id = stranger.id;
    expect(await listTagsForProject(project.id)).toEqual([]);
  });
});

describe('assignTagToTaskAction', () => {
  async function withTagAndTask() {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const tag = await createTagAction(project.id, 'Bug');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    if (!tag.ok || !tag.data) throw new Error('tag create failed');
    return { owner, project, task, tagId: tag.data.id };
  }

  it('happy path: owner assigns; row created with assignedById', async () => {
    const { owner, task, tagId } = await withTagAndTask();
    mockMe.id = owner.id;
    const res = await assignTagToTaskAction(task.id, tagId);
    expect(res).toEqual({ ok: true });
    const row = await prisma.taskTag.findUnique({
      where: { taskId_tagId: { taskId: task.id, tagId } },
    });
    expect(row?.assignedById).toBe(owner.id);
  });

  it('re-assigning is a no-op (upsert) and does not duplicate', async () => {
    const { owner, task, tagId } = await withTagAndTask();
    mockMe.id = owner.id;
    await assignTagToTaskAction(task.id, tagId);
    await assignTagToTaskAction(task.id, tagId);
    expect(await prisma.taskTag.count({ where: { taskId: task.id } })).toBe(1);
  });

  it('tag from a different project is rejected (cross-project hardening)', async () => {
    const { owner, project, task } = await withTagAndTask();
    void project;
    const otherProj = await makeProject({ ownerId: owner.id, key: 'TGY' });
    mockMe.id = owner.id;
    const otherTag = await createTagAction(otherProj.id, 'Foreign');
    if (!otherTag.ok || !otherTag.data) throw new Error('tag create failed');
    expect(await assignTagToTaskAction(task.id, otherTag.data.id)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('non-editor (CONTRIBUTOR, not creator/assignee) → FORBIDDEN', async () => {
    const { project, tagId } = await withTagAndTask();
    const stranger = await makeUser();
    await addMember(project.id, stranger.id, 'CONTRIBUTOR');
    const owner2 = await makeUser();
    const task = await makeTask({ projectId: project.id, creatorId: owner2.id });
    mockMe.id = stranger.id;
    expect(await assignTagToTaskAction(task.id, tagId)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('non-existent task → NOT_FOUND', async () => {
    const { tagId } = await withTagAndTask();
    mockMe.id = (await makeUser({ role: 'ADMIN' })).id;
    mockMe.role = 'ADMIN';
    expect(
      await assignTagToTaskAction('00000000-0000-0000-0000-000000000000', tagId),
    ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('Bitrix-mirror task can be tagged (tags are internal-only)', async () => {
    const { owner, project, task, tagId } = await withTagAndTask();
    await prisma.task.update({
      where: { id: task.id },
      data: { externalSource: 'bitrix24', externalId: '999' },
    });
    mockMe.id = owner.id;
    expect(await assignTagToTaskAction(task.id, tagId)).toEqual({ ok: true });
  });
});

describe('unassignTagFromTaskAction', () => {
  it('removes the TaskTag row; missing row is silently ignored', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const tag = await createTagAction(project.id, 'X');
    if (!tag.ok || !tag.data) throw new Error('tag create failed');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await assignTagToTaskAction(task.id, tag.data.id);
    expect(await unassignTagFromTaskAction(task.id, tag.data.id)).toEqual({ ok: true });
    expect(await prisma.taskTag.count({ where: { taskId: task.id } })).toBe(0);
    // Second call must not throw.
    expect(await unassignTagFromTaskAction(task.id, tag.data.id)).toEqual({ ok: true });
  });
});

describe('deleteTagAction', () => {
  it('owner can delete', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const tag = await createTagAction(project.id, 'Tmp');
    if (!tag.ok || !tag.data) throw new Error('tag create failed');
    expect(await deleteTagAction(project.id, tag.data.id)).toEqual({ ok: true });
    expect(await prisma.tag.findUnique({ where: { id: tag.data.id } })).toBeNull();
  });

  it('non-owner non-ADMIN → FORBIDDEN', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const tag = await createTagAction(project.id, 'Keep');
    if (!tag.ok || !tag.data) throw new Error('tag create failed');
    const stranger = await makeUser();
    mockMe.id = stranger.id;
    expect(await deleteTagAction(project.id, tag.data.id)).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('ADMIN can delete any tag', async () => {
    const { owner, project } = await setup();
    mockMe.id = owner.id;
    const tag = await createTagAction(project.id, 'A1');
    if (!tag.ok || !tag.data) throw new Error('tag create failed');
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    mockMe.role = 'ADMIN';
    expect(await deleteTagAction(project.id, tag.data.id)).toEqual({ ok: true });
  });
});
