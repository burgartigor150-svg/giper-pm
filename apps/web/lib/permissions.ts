import type { UserRole, MemberRole } from '@giper/db';

/**
 * Permission helpers — all synchronous, take already-loaded entities.
 * Source of truth for role matrix: PRIVACY.md "Кто что видит" table.
 */

// Minimal shapes — kept narrow on purpose so callers pass
// projections from Prisma without leaking unrelated fields.
export type SessionUser = {
  id: string;
  role: UserRole;
};

export type ProjectForPerm = {
  ownerId: string;
  members?: { userId: string; role: MemberRole }[];
  /**
   * Optional precomputed signal that *this user* has at least one task
   * (as assignee, creator, or accomplice) in the project. Bitrix-mirror
   * projects don't have ProjectMember rows for our users, but everyone
   * who got a task assigned in Bitrix should still see the project.
   * Callers fill this from a single COUNT query alongside the fetch.
   */
  hasTaskForCurrentUser?: boolean;
};

export type TaskForPerm = {
  creatorId: string;
  assigneeId: string | null;
  reviewerId?: string | null;
  project: ProjectForPerm;
  /** When set, this task is a read-only mirror from an external system. */
  externalSource?: string | null;
  /** Co-assignees (TaskAssignment rows). */
  assignments?: { userId: string }[];
  /** Watchers (TaskWatcher rows). */
  watchers?: { userId: string }[];
};

// ---- Project ------------------------------------------------------------

/** Only ADMIN and PM can create new projects. */
export function canCreateProject(user: SessionUser): boolean {
  return user.role === 'ADMIN' || user.role === 'PM';
}

/** Edit project metadata: ADMIN, project owner, or member with role LEAD. */
export function canEditProject(user: SessionUser, project: ProjectForPerm): boolean {
  if (user.role === 'ADMIN') return true;
  if (project.ownerId === user.id) return true;
  return !!project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * View project: visibility is per-stake for EVERYONE (incl. ADMIN/PM).
 * A user must be the owner, an explicit member, OR own at least one
 * task in the project (the last leg covers Bitrix-mirror groups
 * where membership lives in task assignments rather than ProjectMember).
 *
 * Admin-grade access (audit log, user management, global settings)
 * goes through `canSeeSettings` and friends — not here.
 */
export function canViewProject(user: SessionUser, project: ProjectForPerm): boolean {
  if (project.ownerId === user.id) return true;
  if (project.members?.some((m) => m.userId === user.id)) return true;
  if (project.hasTaskForCurrentUser) return true;
  return false;
}

// ---- Task ---------------------------------------------------------------

/** Create task: any project viewer, plus ADMIN/PM globally. VIEWER role excluded. */
export function canCreateTask(user: SessionUser, project: ProjectForPerm): boolean {
  if (user.role === 'VIEWER') return false;
  return canViewProject(user, project);
}

/**
 * Edit task: ADMIN, project owner, project LEAD, task creator, or assignee.
 *
 * Tasks mirrored from an external system (`externalSource` set) are
 * read-only on our side — editing must happen in the source-of-truth so
 * the next sync doesn't overwrite local changes.
 */
export function canEditTask(user: SessionUser, task: TaskForPerm): boolean {
  if (task.externalSource) return false;
  if (user.role === 'ADMIN') return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.project.ownerId === user.id) return true;
  return !!task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * Edit permission for the *internal* track of a task. Unlike canEditTask,
 * this is allowed on Bitrix-mirrored tasks: internal status, internal
 * assignments, reviewer, estimate, due, tags, priority, checklists,
 * dependencies — none of those round-trip to Bitrix, so editing them
 * on a mirror is safe.
 *
 * Permission shape is otherwise identical to canEditTask: the same
 * roles get the same rights, just without the externalSource veto.
 */
export function canEditTaskInternal(user: SessionUser, task: TaskForPerm): boolean {
  if (user.role === 'ADMIN') return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.project.ownerId === user.id) return true;
  return !!task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * View task. Per-stake visibility for EVERYONE: even ADMIN/PM see only
 * tasks where they personally are owner/LEAD of the project, creator,
 * assignee, reviewer, co-assignee, or watcher. Cross-org browsing is
 * a separate concern (audit log, settings).
 */
export function canViewTask(user: SessionUser, task: TaskForPerm): boolean {
  if (task.project.ownerId === user.id) return true;
  if (task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD')) {
    return true;
  }
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.reviewerId === user.id) return true;
  if (task.assignments?.some((a) => a.userId === user.id)) return true;
  if (task.watchers?.some((w) => w.userId === user.id)) return true;
  return false;
}

/**
 * Delete task (hard delete): ADMIN, project owner, or project LEAD. PM at
 * global level too. Externally-mirrored tasks cannot be deleted from our
 * side — the next sync would re-create them and the audit history would
 * desync from the source.
 */
export function canDeleteTask(user: SessionUser, task: TaskForPerm): boolean {
  if (task.externalSource) return false;
  if (user.role === 'ADMIN') return true;
  if (task.project.ownerId === user.id) return true;
  if (user.role === 'PM') return true;
  return !!task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

// ---- Time ---------------------------------------------------------------

/**
 * View someone else's time entries.
 * Per PRIVACY.md "Кто что видит" matrix:
 *   - everyone can view their own time
 *   - PM/ADMIN see detailed time of the team
 *   - MEMBER sees only aggregates of others (granular call returns false here;
 *     aggregates are exposed via a separate path)
 *   - VIEWER only sees own
 */
export function canViewUserTime(viewer: SessionUser, target: { id: string }): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.role === 'ADMIN' || viewer.role === 'PM') return true;
  return false;
}

/** Edit/delete time entry: own entries always; ADMIN/PM can edit team entries. */
export function canEditTimeEntry(
  user: SessionUser,
  entry: { userId: string },
): boolean {
  if (entry.userId === user.id) return true;
  return user.role === 'ADMIN' || user.role === 'PM';
}

// ---- Activity / Screenshots --------------------------------------------

/** Activity (raw): only owner sees their raw stream; PM/ADMIN see aggregates only. */
export function canViewUserActivity(viewer: SessionUser, target: { id: string }): boolean {
  return viewer.id === target.id;
}

/**
 * Screenshots: per PRIVACY.md, only the employee and their direct PM.
 * ADMIN sees ONLY if employee gave explicit review consent (caller must pass it).
 */
export function canViewUserScreenshots(
  viewer: SessionUser,
  target: { id: string; pmId?: string | null },
  reviewConsent: boolean = false,
): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.role === 'PM' && target.pmId === viewer.id) return true;
  if (viewer.role === 'ADMIN' && reviewConsent) return true;
  return false;
}

// ---- Reports / Settings -----------------------------------------------

/** Reports section visibility (UI-level). VIEWER doesn't see it. */
export function canSeeReports(user: SessionUser): boolean {
  return user.role !== 'VIEWER';
}

/** Settings (admin) visibility (UI-level). Only ADMIN and PM. */
export function canSeeSettings(user: SessionUser): boolean {
  return user.role === 'ADMIN' || user.role === 'PM';
}
