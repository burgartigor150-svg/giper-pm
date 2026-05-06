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
};

export type TaskForPerm = {
  creatorId: string;
  assigneeId: string | null;
  project: ProjectForPerm;
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

/** View project: ADMIN/PM see all; MEMBER/VIEWER see only projects they're a member of. */
export function canViewProject(user: SessionUser, project: ProjectForPerm): boolean {
  if (user.role === 'ADMIN' || user.role === 'PM') return true;
  if (project.ownerId === user.id) return true;
  return !!project.members?.some((m) => m.userId === user.id);
}

// ---- Task ---------------------------------------------------------------

/** Create task: any project viewer, plus ADMIN/PM globally. VIEWER role excluded. */
export function canCreateTask(user: SessionUser, project: ProjectForPerm): boolean {
  if (user.role === 'VIEWER') return false;
  return canViewProject(user, project);
}

/** Edit task: ADMIN, project owner, project LEAD, task creator, or assignee. */
export function canEditTask(user: SessionUser, task: TaskForPerm): boolean {
  if (user.role === 'ADMIN') return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.project.ownerId === user.id) return true;
  return !!task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/** View task: same as viewing the parent project. */
export function canViewTask(user: SessionUser, task: TaskForPerm): boolean {
  return canViewProject(user, task.project);
}

/** Delete task (hard delete): ADMIN, project owner, or project LEAD. PM at global level too. */
export function canDeleteTask(user: SessionUser, task: TaskForPerm): boolean {
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
