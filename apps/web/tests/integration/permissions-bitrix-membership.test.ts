import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { createTask } from '@/lib/tasks/createTask';
import { logTimeManually } from '@/lib/time/logTimeManually';
import { getProject, listProjectsForUser } from '@/lib/projects';
import { makeUser, makeProject, sessionUser } from './helpers/factories';

/**
 * Regression for the "only the admin can create tasks / log time" lockout.
 *
 * The org's projects are almost all Bitrix workgroup mirrors. A regular
 * MEMBER who was synced into a workgroup (ProjectBitrixMember) but holds no
 * task there must still be able to reach the project, create a task, and log
 * time — their real workgroup membership IS the access signal. This leg was
 * dropped in #88 and reinstated here.
 */

/** Turn a fresh project into a Bitrix-mirror workgroup owned by `ownerId`. */
async function makeMirrorProject(ownerId: string, key: string) {
  const project = await makeProject({ ownerId, key });
  await prisma.project.update({
    where: { id: project.id },
    data: { externalSource: 'bitrix24', externalId: `wg-${project.id}` },
  });
  return project;
}

describe('Bitrix workgroup membership grants project access', () => {
  it('a workgroup member with NO task stake can view, create a task, and log time', async () => {
    // Owner is a separate lead; `emp` is only a synced workgroup member.
    const owner = await makeUser({ role: 'MEMBER' });
    const emp = await makeUser({ role: 'MEMBER' });
    const project = await makeMirrorProject(owner.id, 'WG');

    await prisma.projectBitrixMember.create({
      data: {
        projectId: project.id,
        bitrixUserId: 'bx-emp',
        userId: emp.id,
        role: 'A',
      },
    });

    // (a) sees the project
    const detail = await getProject(project.key, sessionUser(emp));
    expect(detail.key).toBe(project.key);

    // (b) creates a task in it
    const created = await createTask(
      { projectKey: project.key, title: 'Задача от сотрудника', tags: [] },
      sessionUser(emp),
    );
    expect(created.id).toBeTruthy();
    const persisted = await prisma.task.findUniqueOrThrow({ where: { id: created.id } });
    expect(persisted.creatorId).toBe(emp.id);

    // (c) logs time on that task
    const entry = await logTimeManually(
      {
        taskId: created.id,
        startedAt: new Date('2026-06-30T09:00:00.000Z'),
        endedAt: new Date('2026-06-30T10:00:00.000Z'),
      },
      sessionUser(emp),
    );
    expect(entry.durationMin).toBe(60);
    const savedEntry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(savedEntry.userId).toBe(emp.id);
    expect(savedEntry.taskId).toBe(created.id);

    // (d) the project shows up in their list
    const list = await listProjectsForUser(sessionUser(emp));
    expect(list.map((p) => p.key)).toContain(project.key);
  });

  it('a non-member MEMBER with no stake is still denied', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeMirrorProject(owner.id, 'WX');

    await expect(getProject(project.key, sessionUser(stranger))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INSUFFICIENT_PERMISSIONS',
    });

    await expect(
      createTask(
        { projectKey: project.key, title: 'Не должно пройти', tags: [] },
        sessionUser(stranger),
      ),
    ).rejects.toMatchObject({ name: 'DomainError' });

    const list = await listProjectsForUser(sessionUser(stranger));
    expect(list.map((p) => p.key)).not.toContain(project.key);
  });
});
