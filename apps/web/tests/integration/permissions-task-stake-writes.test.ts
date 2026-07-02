import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { createTask } from '@/lib/tasks/createTask';
import { startTimer } from '@/lib/time/startTimer';
import { logTimeManually } from '@/lib/time/logTimeManually';
import { makeUser, makeProject, makeTask, sessionUser } from './helpers/factories';

/**
 * Regression: "никто кроме меня не может создавать задачи и писать отчёты
 * по времени."
 *
 * The read gates (getProject/board/list/gantt) let a user in via a TASK STAKE
 * (they are creator/assignee/reviewer/tester/co-assignee/watcher of some task),
 * but the WRITE gates (createTask, startTimer, logTimeManually) called
 * canViewProject WITHOUT the task-stake leg — so a member assigned to a task in
 * a Bitrix-mirror project, who is not owner/native-member/linked-Bitrix-member,
 * could OPEN the task but got INSUFFICIENT_PERMISSIONS on every write. Prod: 260
 * users / 498 user-project pairs in exactly this state.
 */

async function makeMirrorProject(ownerId: string, key: string) {
  const project = await makeProject({ ownerId, key });
  await prisma.project.update({
    where: { id: project.id },
    data: { externalSource: 'bitrix24', externalId: `wg-${project.id}` },
  });
  return project;
}

describe('task stake grants write access (create task / log time)', () => {
  it('an assignee with no project membership can start a timer, log time, and create a task', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const emp = await makeUser({ role: 'MEMBER' });
    const project = await makeMirrorProject(owner.id, 'TS');
    // emp's ONLY connection to the project: assigned to this task. No owner /
    // ProjectMember / ProjectBitrixMember row.
    const assigned = await makeTask({
      projectId: project.id,
      creatorId: owner.id,
      assigneeId: emp.id,
    });

    // start a timer on the assigned task
    const timer = await startTimer(assigned.id, sessionUser(emp));
    expect(timer.taskId).toBe(assigned.id);

    // log time manually on the assigned task
    const entry = await logTimeManually(
      {
        taskId: assigned.id,
        startedAt: new Date('2026-06-20T09:00:00.000Z'),
        endedAt: new Date('2026-06-20T15:00:00.000Z'),
      },
      sessionUser(emp),
    );
    expect(entry.durationMin).toBe(360);

    // create a NEW task in that project (participant via the assigned task)
    const created = await createTask(
      { projectKey: project.key, title: 'Новая от исполнителя', tags: [] },
      sessionUser(emp),
    );
    expect(created.id).toBeTruthy();
    expect(created.project.key).toBe(project.key);
  });

  it('a watcher (no membership) can log time on the watched task', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const watcher = await makeUser({ role: 'MEMBER' });
    const project = await makeMirrorProject(owner.id, 'TW');
    const task = await makeTask({ projectId: project.id, creatorId: owner.id });
    await prisma.taskWatcher.create({ data: { taskId: task.id, userId: watcher.id } });

    const entry = await logTimeManually(
      {
        taskId: task.id,
        startedAt: new Date('2026-06-20T09:00:00.000Z'),
        endedAt: new Date('2026-06-20T10:00:00.000Z'),
      },
      sessionUser(watcher),
    );
    expect(entry.durationMin).toBe(60);
  });

  it('a true stranger (no stake, no membership) is still denied on all writes', async () => {
    const owner = await makeUser({ role: 'MEMBER' });
    const stranger = await makeUser({ role: 'MEMBER' });
    const project = await makeMirrorProject(owner.id, 'TX');
    // A task the stranger is NOT on.
    const other = await makeTask({ projectId: project.id, creatorId: owner.id });

    await expect(startTimer(other.id, sessionUser(stranger))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'INSUFFICIENT_PERMISSIONS',
    });
    await expect(
      logTimeManually(
        {
          taskId: other.id,
          startedAt: new Date('2026-06-20T09:00:00.000Z'),
          endedAt: new Date('2026-06-20T10:00:00.000Z'),
        },
        sessionUser(stranger),
      ),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'INSUFFICIENT_PERMISSIONS' });
    await expect(
      createTask(
        { projectKey: project.key, title: 'Не должно пройти', tags: [] },
        sessionUser(stranger),
      ),
    ).rejects.toMatchObject({ name: 'DomainError', code: 'INSUFFICIENT_PERMISSIONS' });
  });
});
