import { describe, it, expect } from 'vitest';
import { prisma } from '@giper/db';
import { handleMergeRequest, handlePush } from '@/lib/integrations/gitlab/handlers';
import { makeUser, makeProject, makeTask } from './helpers/factories';

/**
 * GitLab webhook handlers — MR linkage (TaskPullRequest, provider='gitlab')
 * and push→commit comment. Linkage is by `KEY-N` ref in branch/title/message.
 */
describe('gitlab handleMergeRequest', () => {
  async function taskInProject(key: string, number = 7) {
    const owner = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id, key });
    const t = await makeTask({ projectId: p.id, number, creatorId: owner.id });
    return { owner, p, t };
  }

  it('links an MR to a task referenced in the source branch', async () => {
    const { t } = await taskInProject('GLA', 7);
    const res = await handleMergeRequest({
      object_kind: 'merge_request',
      project: { path_with_namespace: 'team/web' },
      user: { username: 'alice' },
      object_attributes: {
        iid: 12,
        title: 'Add feature',
        description: 'no ref here',
        state: 'opened',
        source_branch: 'feature/GLA-7-add',
        target_branch: 'main',
        url: 'https://gitlab.com/team/web/-/merge_requests/12',
      },
    });
    expect(res.upserted).toBe(1);
    const pr = await prisma.taskPullRequest.findFirstOrThrow({ where: { taskId: t.id } });
    expect(pr.provider).toBe('gitlab');
    expect(pr.repo).toBe('team/web');
    expect(pr.number).toBe(12);
    expect(pr.state).toBe('OPEN');
    expect(pr.headRef).toBe('feature/GLA-7-add');
    expect(pr.baseRef).toBe('main');
    expect(pr.authorLogin).toBe('alice');
  });

  it('maps merged state with mergedAt and is idempotent on re-delivery', async () => {
    const { t } = await taskInProject('GLB', 3);
    const base = {
      object_kind: 'merge_request' as const,
      project: { path_with_namespace: 'team/api' },
      user: { username: 'bob' },
      object_attributes: {
        iid: 5,
        title: 'GLB-3 fix bug',
        state: 'merged' as const,
        source_branch: 'fix',
        target_branch: 'main',
        url: 'https://gitlab.com/team/api/-/merge_requests/5',
        merged_at: '2026-06-22T10:00:00Z',
      },
    };
    await handleMergeRequest(base);
    await handleMergeRequest(base); // redelivery
    const rows = await prisma.taskPullRequest.findMany({ where: { taskId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('MERGED');
    expect(rows[0]!.mergedAt).toBeInstanceOf(Date);
  });

  it('derives DRAFT from work_in_progress', async () => {
    const { t } = await taskInProject('GLC', 9);
    await handleMergeRequest({
      object_kind: 'merge_request',
      project: { path_with_namespace: 'team/x' },
      object_attributes: {
        iid: 1,
        title: 'GLC-9 wip',
        state: 'opened',
        work_in_progress: true,
        source_branch: 'wip',
        target_branch: 'main',
        url: 'https://gitlab.com/team/x/-/merge_requests/1',
      },
    });
    const pr = await prisma.taskPullRequest.findFirstOrThrow({ where: { taskId: t.id } });
    expect(pr.state).toBe('DRAFT');
  });

  it('does nothing when no task ref is present', async () => {
    await taskInProject('GLD', 4);
    const res = await handleMergeRequest({
      object_kind: 'merge_request',
      project: { path_with_namespace: 'team/y' },
      object_attributes: {
        iid: 2,
        title: 'no references at all',
        state: 'opened',
        source_branch: 'misc',
        target_branch: 'main',
        url: 'https://gitlab.com/team/y/-/merge_requests/2',
      },
    });
    expect(res.upserted).toBe(0);
  });
});

describe('gitlab handlePush', () => {
  it('posts an internal GITLAB comment for a referencing commit; idempotent', async () => {
    const owner = await makeUser({ role: 'ADMIN' });
    const p = await makeProject({ ownerId: owner.id, key: 'GLP' });
    const t = await makeTask({ projectId: p.id, number: 11, creatorId: owner.id });

    const payload = {
      object_kind: 'push' as const,
      project: { path_with_namespace: 'team/web', web_url: 'https://gitlab.com/team/web' },
      user_name: 'Carol',
      commits: [
        {
          id: 'abc123def456',
          message: 'GLP-11 implement thing',
          url: 'https://gitlab.com/team/web/-/commit/abc123def456',
          author: { name: 'Carol' },
        },
      ],
    };
    const r1 = await handlePush(payload);
    expect(r1.comments).toBe(1);
    const r2 = await handlePush(payload); // redelivery
    expect(r2.comments).toBe(0);

    const comments = await prisma.comment.findMany({
      where: { taskId: t.id, externalSource: 'gitlab' },
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]!.source).toBe('GITLAB');
    expect(comments[0]!.visibility).toBe('INTERNAL');
    expect(comments[0]!.body).toContain('team/web');
  });
});
