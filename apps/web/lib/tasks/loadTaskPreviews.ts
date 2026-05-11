import { prisma } from '@giper/db';
import type { TaskRef } from '@/lib/text/taskRefs';

export type TaskPreview = {
  key: string;
  number: number;
  projectKey: string;
  title: string;
  internalStatus: string;
  priority: string;
  assignee: { id: string; name: string; image: string | null } | null;
  dueDate: string | null;
  // True iff the requesting user is allowed to view this task. When
  // false, the renderer shows a "недоступно" stub instead of leaking
  // title/assignee to a non-stakeholder.
  visible: boolean;
};

/**
 * Resolve a batch of (projectKey, number) refs into preview cards
 * with per-user visibility applied.
 *
 * Visibility rule mirrors `canViewTask` (strict per-stake — see
 * lib/permissions.canViewTask): the viewer must be creator,
 * assignee, reviewer, co-assignee, or watcher. Tasks the viewer
 * can't see come back with `visible: false` + only key/number
 * populated, so the renderer can show "GPM-142 (нет доступа)"
 * instead of silently dropping the link.
 *
 * One single query, regardless of how many refs were extracted from
 * the message — the message renderer never N+1s the DB.
 */
export async function loadTaskPreviewsForRefs(
  refs: TaskRef[],
  viewerId: string,
): Promise<Map<string, TaskPreview>> {
  const out = new Map<string, TaskPreview>();
  if (refs.length === 0) return out;

  // Build a single WHERE that ORs every (key, number) pair. With
  // ≤ 20 refs per message this stays cheap; we cap at 20 to be
  // safe against pathological pastes.
  const capped = refs.slice(0, 20);
  const rows = await prisma.task.findMany({
    where: {
      OR: capped.map((r) => ({
        project: { key: r.key },
        number: r.number,
      })),
    },
    select: {
      id: true,
      number: true,
      title: true,
      internalStatus: true,
      priority: true,
      dueDate: true,
      creatorId: true,
      assigneeId: true,
      reviewerId: true,
      project: { select: { key: true } },
      assignee: { select: { id: true, name: true, image: true } },
      assignments: { select: { userId: true } },
      watchers: { select: { userId: true } },
    },
  });

  for (const t of rows) {
    const visible =
      t.creatorId === viewerId ||
      t.assigneeId === viewerId ||
      t.reviewerId === viewerId ||
      t.assignments.some((a) => a.userId === viewerId) ||
      t.watchers.some((w) => w.userId === viewerId);
    const key = `${t.project.key}-${t.number}`;
    out.set(key, {
      key,
      number: t.number,
      projectKey: t.project.key,
      title: visible ? t.title : '',
      internalStatus: visible ? t.internalStatus : '',
      priority: visible ? t.priority : '',
      assignee: visible ? t.assignee : null,
      dueDate: visible && t.dueDate ? t.dueDate.toISOString() : null,
      visible,
    });
  }

  // For refs that didn't match any task (typo / deleted task) we
  // still surface them so the UI can render "GPM-999 (не найдена)"
  // instead of silently dropping the reference.
  for (const r of capped) {
    const k = `${r.key}-${r.number}`;
    if (!out.has(k)) {
      out.set(k, {
        key: k,
        number: r.number,
        projectKey: r.key,
        title: '',
        internalStatus: '',
        priority: '',
        assignee: null,
        dueDate: null,
        visible: false,
      });
    }
  }

  return out;
}
