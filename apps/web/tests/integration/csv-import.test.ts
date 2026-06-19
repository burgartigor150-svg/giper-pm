import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for CSV task import:
 *   - parseCsv (quotes, embedded commas, escaped quotes, newlines).
 *   - importTasksFromCsvAction (create, assignee-by-email, bad rows, missing
 *     title column, RBAC).
 *
 * Source: apps/web/lib/import/parseCsv.ts, apps/web/actions/importTasks.ts
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
import { parseCsv } from '@/lib/import/parseCsv';
import { importTasksFromCsvAction } from '@/actions/importTasks';
import { makeUser, makeProject, addMember } from './helpers/factories';

beforeEach(() => {
  mockMe.role = 'ADMIN';
});

describe('parseCsv', () => {
  it('parses quotes, embedded commas, escaped quotes, newlines', () => {
    const csv = 'title,description\n"A, B","line1\nline2"\nSimple,"He said ""hi"""';
    const rows = parseCsv(csv);
    expect(rows).toEqual([
      ['title', 'description'],
      ['A, B', 'line1\nline2'],
      ['Simple', 'He said "hi"'],
    ]);
  });

  it('drops fully empty lines', () => {
    expect(parseCsv('title\n\nX\n')).toEqual([['title'], ['X']]);
  });
});

describe('importTasksFromCsvAction', () => {
  it('creates tasks and resolves assignee by email', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id, key: 'IMPA' });
    const dev = await makeUser({ email: 'dev@team.test' });
    await addMember(project.id, dev.id);

    const csv = [
      'title,type,priority,assignee,estimate',
      'Свёрстать лендинг,FEATURE,HIGH,dev@team.test,8',
      'Починить баг,BUG,URGENT,,2',
    ].join('\n');

    const res = await importTasksFromCsvAction(project.key, csv);
    expect(res.ok).toBe(true);
    expect(res.ok && res.data.created).toBe(2);

    const tasks = await prisma.task.findMany({
      where: { projectId: project.id },
      select: { title: true, type: true, priority: true, assigneeId: true },
    });
    expect(tasks).toHaveLength(2);
    const landing = tasks.find((t) => t.title === 'Свёрстать лендинг');
    expect(landing?.type).toBe('FEATURE');
    expect(landing?.priority).toBe('HIGH');
    expect(landing?.assigneeId).toBe(dev.id);
  });

  it('reports per-row errors (empty title) without aborting the batch', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id, key: 'IMPB' });

    const csv = 'title\nGood task\n\nx'; // empty line dropped; "x" is too short (<2)
    const res = await importTasksFromCsvAction(project.key, csv);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.created).toBe(1);
      expect(res.data.failed).toBe(1);
      expect(res.data.errors).toHaveLength(1);
    }
  });

  it('rejects CSV with no title column', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    mockMe.id = admin.id;
    const project = await makeProject({ ownerId: admin.id, key: 'IMPC' });
    const res = await importTasksFromCsvAction(project.key, 'description,type\nfoo,BUG');
    expect(res.ok).toBe(false);
  });

  it('forbids a VIEWER', async () => {
    const owner = await makeUser();
    const project = await makeProject({ ownerId: owner.id, key: 'IMPD' });
    mockMe.id = (await makeUser({ role: 'VIEWER' })).id;
    mockMe.role = 'VIEWER';
    const res = await importTasksFromCsvAction(project.key, 'title\nX task');
    expect(res.ok).toBe(false);
  });
});
