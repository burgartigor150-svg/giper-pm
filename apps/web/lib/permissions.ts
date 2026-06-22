import type { UserRole, MemberRole } from '@giper/db';
// Type-only (erased at runtime → no import cycle with capabilities/resolve.ts).
import type { EffectiveCaps } from './capabilities';

/**
 * Permission helpers — all synchronous, take already-loaded entities.
 * Source of truth for role matrix: PRIVACY.md "Кто что видит" table.
 *
 * Custom-roles overlay (additive, inert until wired): org-level helpers accept
 * an optional `caps?: EffectiveCaps`. When provided (a call site that resolved
 * the user's effective capabilities), the ORG-LEVEL leg is decided by
 * `caps.has(<key>)` (REPLACE semantics — supports grant AND restrict); per-stake
 * / owner / LEAD / consent legs are unchanged. When omitted (today's callers),
 * the helper is byte-identical to before — so this slice changes no behavior.
 * Hard per-stake floors (canViewProject, canViewTask, canViewUserActivity) take
 * NO caps param: no capability can ever widen them.
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
   * (as creator/assignee/reviewer/co-assignee/watcher) in the project.
   * Catches manually-created projects + edge cases where Bitrix
   * membership sync is lagging behind a task assignment.
   */
  hasTaskForCurrentUser?: boolean;
  /**
   * Optional precomputed signal that *this user* is mirrored in the
   * Bitrix sonet_group for this project (ProjectBitrixMember row).
   * Primary source of truth for visibility on Bitrix-mirrored
   * projects — a user sees the project the moment Bitrix sync adds
   * them, even before any task is assigned.
   */
  isBitrixMemberForCurrentUser?: boolean;
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
export function canCreateProject(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('project.create');
  return user.role === 'ADMIN' || user.role === 'PM';
}

/** Edit project metadata: ADMIN (org), project owner, or member with role LEAD. */
export function canEditProject(user: SessionUser, project: ProjectForPerm, caps?: EffectiveCaps): boolean {
  const org = caps ? caps.has('project.edit') : user.role === 'ADMIN';
  if (org) return true;
  if (project.ownerId === user.id) return true;
  return !!project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * Decide who staffs a task: change assignee, add/remove co-assignees,
 * pick a reviewer. Resource management is a PM concern — regular
 * MEMBERs can comment, watch, and edit their own tasks but they
 * shouldn't be able to reassign work to others.
 *
 * Allowed: ADMIN, PM (global), project owner, project LEAD.
 */
export function canManageAssignments(
  user: SessionUser,
  project: ProjectForPerm,
  caps?: EffectiveCaps,
): boolean {
  const org = caps ? caps.has('task.staff') : user.role === 'ADMIN' || user.role === 'PM';
  if (org) return true;
  if (project.ownerId === user.id) return true;
  return !!project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * View project — STRICT per-stake for everyone (incl. ADMIN/PM).
 *
 * A user sees a project iff ANY of these is true:
 *   - they are the project owner (covers freshly-created projects)
 *   - they are a ProjectMember (internal team-role assignment)
 *   - they have a task stake in the project
 *     (`hasTaskForCurrentUser`) — creator/assignee/reviewer/co-assignee/watcher
 *
 * Bitrix sonet_group membership is intentionally NOT a leg: workgroups
 * can be large and a synced member often holds no task there, so it
 * buried the projects that actually matter. Mirrored membership without
 * a real stake grants nothing. Kept in lockstep with listProjectsForUser.
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

/**
 * Leadership task visibility: ADMIN (org), the project owner, or a project
 * LEAD see EVERY task in the project — including Bitrix-mirror tasks they
 * personally aren't on. This is the deliberate exception to the per-stake
 * default (see {@link canViewTask}) so leadership gets the full picture of a
 * mirrored workgroup; regular members stay per-stake.
 */
export function canViewAllProjectTasks(user: SessionUser, project: ProjectForPerm): boolean {
  if (user.role === 'ADMIN') return true;
  if (project.ownerId === user.id) return true;
  return !!project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
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
export function canEditTask(user: SessionUser, task: TaskForPerm, caps?: EffectiveCaps): boolean {
  if (task.externalSource) return false;
  const org = caps ? caps.has('task.editAny') : user.role === 'ADMIN';
  if (org) return true;
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
export function canEditTaskInternal(user: SessionUser, task: TaskForPerm, caps?: EffectiveCaps): boolean {
  const org = caps ? caps.has('task.editAny') : user.role === 'ADMIN';
  if (org) return true;
  if (task.creatorId === user.id) return true;
  if (task.assigneeId === user.id) return true;
  if (task.project.ownerId === user.id) return true;
  return !!task.project.members?.some((m) => m.userId === user.id && m.role === 'LEAD');
}

/**
 * View task. Per-stake for regular members: a user must personally be on the
 * task (creator, assignee, reviewer, co-assignee, watcher). Leadership (ADMIN,
 * project owner, project LEAD) additionally sees every task in the project —
 * see {@link canViewAllProjectTasks} — so they get the full picture of a
 * mirrored Bitrix workgroup instead of only the tasks they're personally on.
 */
export function canViewTask(user: SessionUser, task: TaskForPerm): boolean {
  if (canViewAllProjectTasks(user, task.project)) return true;
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
export function canDeleteTask(user: SessionUser, task: TaskForPerm, caps?: EffectiveCaps): boolean {
  if (task.externalSource) return false;
  const org = caps ? caps.has('task.delete') : user.role === 'ADMIN' || user.role === 'PM';
  if (org) return true;
  if (task.project.ownerId === user.id) return true;
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
export function canViewUserTime(viewer: SessionUser, target: { id: string }, caps?: EffectiveCaps): boolean {
  if (viewer.id === target.id) return true;
  if (caps) return caps.has('reports.viewTeamTime');
  return viewer.role === 'ADMIN' || viewer.role === 'PM';
}

/** Edit/delete time entry: own entries always; ADMIN/PM can edit team entries. */
export function canEditTimeEntry(
  user: SessionUser,
  entry: { userId: string },
  caps?: EffectiveCaps,
): boolean {
  if (entry.userId === user.id) return true;
  if (caps) return caps.has('reports.viewTeamTime');
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
  caps?: EffectiveCaps,
): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.role === 'PM' && target.pmId === viewer.id) return true;
  // Org-level screenshot access still requires explicit review consent — the
  // capability only replaces the role check, never the consent floor.
  const org = caps ? caps.has('reports.viewScreenshots') : viewer.role === 'ADMIN';
  if (org && reviewConsent) return true;
  return false;
}

// ---- Reports / Settings -----------------------------------------------

/** Reports section visibility (UI-level). VIEWER doesn't see it. */
export function canSeeReports(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('reports.view');
  return user.role !== 'VIEWER';
}

/** Settings (admin) visibility (UI-level). Only ADMIN and PM. */
export function canSeeSettings(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('settings.view');
  return user.role === 'ADMIN' || user.role === 'PM';
}

/**
 * Privileged (org-wide) CRM access. ADMIN/PM see and edit ALL CRM data.
 * These stay pure-role on purpose — they now mean "full-org CRM". Callers that
 * must also include opt-in scoped sales reps use `resolveCrmAccess(...)` instead
 * (below). Do NOT widen these bodies, or unrelated callers leak.
 */
export function canSeeCrm(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('crm.view');
  return user.role === 'ADMIN' || user.role === 'PM';
}
export function canEditCrm(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('crm.edit');
  return user.role === 'ADMIN' || user.role === 'PM';
}

/** How much of the CRM a user may touch. */
export type CrmScope = 'all' | 'own' | 'none';
export type CrmAccess = { canSee: boolean; scope: CrmScope };

/**
 * Resolve CRM access for a user. `crmAccess` MUST be read from the DB at request
 * time (see getMyCrmAccess in lib/crm.ts), NEVER piggybacked on the session/JWT —
 * auth only refreshes role on an explicit update, so a session-carried flag would
 * lag an admin grant/revoke by up to a full session, and revoke-lag (a
 * de-authorized rep keeping access) is the dangerous direction.
 *
 *   ADMIN | PM                 → { canSee:true,  scope:'all'  }  (org-wide, unchanged)
 *   VIEWER                     → { canSee:false, scope:'none' }  (hard exclusion even if flag set)
 *   crmAccess===true (MEMBER)  → { canSee:true,  scope:'own'  }  (scoped sales rep)
 *   else (default for all)     → { canSee:false, scope:'none' }
 */
export function resolveCrmAccess(user: SessionUser, crmAccess: boolean): CrmAccess {
  if (user.role === 'ADMIN' || user.role === 'PM') return { canSee: true, scope: 'all' };
  if (user.role === 'VIEWER') return { canSee: false, scope: 'none' };
  if (crmAccess) return { canSee: true, scope: 'own' };
  return { canSee: false, scope: 'none' };
}

/** Own-only mutation check for scoped reps. scope 'all' always passes. */
export function canMutateCrmRecord(access: CrmAccess, ownerId: string | null, meId: string): boolean {
  if (access.scope === 'all') return true;
  if (access.scope === 'none') return false;
  return ownerId === meId; // scope === 'own'
}

/** Destructive pipeline ops (archive/delete) are ADMIN-only. */
export function canDeleteCrmPipeline(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('crm.pipeline.destroy');
  return user.role === 'ADMIN';
}

/** Service-desk agent queue is for ADMIN/PM; everyone but VIEWER can log/work tickets. */
export function canSeeServiceDesk(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('servicedesk.viewQueue');
  return user.role === 'ADMIN' || user.role === 'PM';
}
export function canWorkTickets(user: SessionUser, caps?: EffectiveCaps): boolean {
  if (caps) return caps.has('servicedesk.workTickets');
  return user.role !== 'VIEWER';
}
