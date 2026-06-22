import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { getGanttData } from '@/lib/gantt/getGanttData';
import { makeProject, makeTask, makeUser, sessionUser } from './helpers/factories';

describe('getGanttData — dependency edges', () => {
  it('regular member: edges only when BOTH endpoints are per-stake visible', async () => {
    const owner = await makeUser();
    const me = await makeUser(); // plain MEMBER, not owner/LEAD/admin
    const other = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    // me is the creator of A and B → visible; C is created by someone else
    // with no stake for me → out of scope (me is NOT leadership).
    const a = await makeTask({ projectId: project.id, creatorId: me.id, title: 'A' });
    const b = await makeTask({ projectId: project.id, creatorId: me.id, title: 'B' });
    const c = await makeTask({ projectId: project.id, creatorId: other.id, title: 'C' });

    // A blocks B (both visible); B blocks C (C hidden → edge must be dropped).
    await prisma.taskDependency.create({
      data: { fromTaskId: a.id, toTaskId: b.id, createdById: me.id },
    });
    await prisma.taskDependency.create({
      data: { fromTaskId: b.id, toTaskId: c.id, createdById: me.id },
    });

    const data = await getGanttData(project.key, sessionUser(me));
    const visibleIds = data.tasks.map((t) => t.id);
    expect(visibleIds).toContain(a.id);
    expect(visibleIds).toContain(b.id);
    expect(visibleIds).not.toContain(c.id);

    expect(data.deps).toHaveLength(1);
    expect(data.deps[0]).toEqual({ from: a.id, to: b.id });
  });

  it('leadership (project owner) sees all tasks and all edges', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const project = await makeProject({ ownerId: owner.id });

    // All three created by `other` — the owner has no personal stake on any.
    const a = await makeTask({ projectId: project.id, creatorId: other.id, title: 'A' });
    const b = await makeTask({ projectId: project.id, creatorId: other.id, title: 'B' });
    const c = await makeTask({ projectId: project.id, creatorId: other.id, title: 'C' });
    await prisma.taskDependency.create({
      data: { fromTaskId: a.id, toTaskId: b.id, createdById: other.id },
    });
    await prisma.taskDependency.create({
      data: { fromTaskId: b.id, toTaskId: c.id, createdById: other.id },
    });

    const data = await getGanttData(project.key, sessionUser(owner));
    const visibleIds = data.tasks.map((t) => t.id);
    expect(visibleIds).toContain(a.id);
    expect(visibleIds).toContain(b.id);
    expect(visibleIds).toContain(c.id);
    expect(data.deps).toHaveLength(2);
  });
});
