'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type TaskStatus } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';

type ActionResult = { ok: true } | { ok: false; error: { code: string; message: string } };

const STATUSES: readonly TaskStatus[] = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'BLOCKED', 'DONE', 'CANCELED',
];
const STATUS_SET = new Set<string>(STATUSES);

/** A self-edge (from===to) is meaningless; cap the set to the N×N grid. */
const MAX_EDGES = STATUSES.length * STATUSES.length;

/**
 * Replace a project's configurable-workflow transition allowlist with `edges`.
 * Empty `edges` clears the workflow → the project reverts to UNRESTRICTED
 * (inert) status moves. Gated on canEditProject (per-project caps honored).
 */
export async function setWorkflowTransitionsAction(
  projectKey: string,
  edges: { from: string; to: string }[],
): Promise<ActionResult> {
  const me = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: 'Нет доступа к проекту' } };
    throw e;
  }
  const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id);
  if (!canEditProject({ id: me.id, role: me.role }, project, caps)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  if (!Array.isArray(edges) || edges.length > MAX_EDGES) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный набор переходов' } };
  }
  // Sanitize: drop self-edges + unknown statuses; dedupe by (from,to).
  const seen = new Set<string>();
  const clean: { fromStatus: TaskStatus; toStatus: TaskStatus }[] = [];
  for (const e of edges) {
    if (!e || !STATUS_SET.has(e.from) || !STATUS_SET.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ fromStatus: e.from as TaskStatus, toStatus: e.to as TaskStatus });
  }

  // Replace the whole set atomically — the allowlist is small, so a full swap is
  // simplest and avoids partial-state windows.
  await prisma.$transaction([
    prisma.workflowTransition.deleteMany({ where: { projectId: project.id } }),
    ...(clean.length > 0
      ? [prisma.workflowTransition.createMany({
          data: clean.map((c) => ({ projectId: project.id, fromStatus: c.fromStatus, toStatus: c.toStatus })),
        })]
      : []),
  ]);

  revalidatePath(`/projects/${project.key}/settings`);
  revalidatePath(`/projects/${project.key}/board`);
  return { ok: true };
}

/** Generous cap for the per-column allowlist (columns × columns). */
const MAX_COLUMN_EDGES = 400;

/**
 * Replace a project's per-COLUMN transition allowlist (free-form boards). Empty
 * `edges` clears it → same-category column moves are UNRESTRICTED again (inert).
 * Gated on canEditProject. Edges reference BoardColumn ids; any id not belonging
 * to this project is dropped (so a crafted/foreign id can't be stored). A
 * separate table from the category allowlist, so clearing column rules never
 * touches the category workflow.
 */
export async function setWorkflowColumnTransitionsAction(
  projectKey: string,
  edges: { from: string; to: string }[],
): Promise<ActionResult> {
  const me = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: me.id, role: me.role });
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: 'Нет доступа к проекту' } };
    throw e;
  }
  const caps = await getEffectiveCapsForProject({ id: me.id, role: me.role }, project.id);
  if (!canEditProject({ id: me.id, role: me.role }, project, caps)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  if (!Array.isArray(edges) || edges.length > MAX_COLUMN_EDGES) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Некорректный набор переходов' } };
  }
  // Scope every column id to THIS project — drop self-edges, foreign/unknown ids,
  // and duplicates.
  const cols = await prisma.boardColumn.findMany({
    where: { projectId: project.id },
    select: { id: true },
  });
  const colIds = new Set(cols.map((c) => c.id));
  const seen = new Set<string>();
  const clean: { fromColumnId: string; toColumnId: string }[] = [];
  for (const e of edges) {
    if (!e || !colIds.has(e.from) || !colIds.has(e.to) || e.from === e.to) continue;
    const k = `${e.from}->${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    clean.push({ fromColumnId: e.from, toColumnId: e.to });
  }

  await prisma.$transaction([
    prisma.workflowColumnTransition.deleteMany({ where: { projectId: project.id } }),
    ...(clean.length > 0
      ? [
          prisma.workflowColumnTransition.createMany({
            data: clean.map((c) => ({
              projectId: project.id,
              fromColumnId: c.fromColumnId,
              toColumnId: c.toColumnId,
            })),
          }),
        ]
      : []),
  ]);

  revalidatePath(`/projects/${project.key}/settings`);
  revalidatePath(`/projects/${project.key}/board`);
  return { ok: true };
}
