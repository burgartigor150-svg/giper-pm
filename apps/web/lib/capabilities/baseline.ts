import type { UserRole } from '@giper/db';
import { CAPABILITY_KEYS, type CapabilityKey } from './catalog';

/**
 * BASELINE_CAPS — today's org permission matrix encoded as data, one Set per
 * UserRole. This is the SINGLE source for "what a user with no custom role can
 * do at the org level".
 *
 * How it's kept honest (capabilities.test.ts):
 *  - the 9 keys that map to a pure exported helper (reports.view, settings.view,
 *    crm.view, crm.edit, crm.pipeline.destroy, servicedesk.viewQueue,
 *    servicedesk.workTickets, project.create, reports.viewTeamTime) are anchored
 *    to RUNTIME truth by calling the helper — non-circular.
 *  - the remaining keys map to inline `role===` literals with no exported helper
 *    to call; they are pinned by an explicit baseline SNAPSHOT (any edit here
 *    trips a visible test diff) + structural invariants. Their full literal↔cap
 *    equivalence is proven per-surface when each area is wired in slice 4.
 *
 * Provenance of the non-helper keys (verified against source):
 *   project.viewAll←listProjectsForUser.ts:27 · project.edit←permissions.ts canEditProject (ADMIN org leg)
 *   task.delete←permissions.ts:171 · task.staff←assignments.ts:193 · task.editAny←permissions.ts:120/138
 *   task.review.close←review.ts:39 · task.testing.close←testing.ts (acceptTestingAction gate) · task.checklist.toggle←checklists.ts:200 · task.attachments.manageAny←attachments.ts:143
 *   task.tags.assign←tags.ts:51 · crm.scope.*←resolveCrmAccess permissions.ts:264 · reports.teamScope←reports/scope.ts:38
 *   reports.viewScreenshots←permissions.ts canViewUserScreenshots (ADMIN leg) · settings.*←settings/* page guards + actions
 *   users.*←lib/users/* · team.*←layout.ts:30 + pmTeam.ts:25 · integrations.*←integrations.ts/telegram*
 *   meetings.*←meetings.ts/calendar · messenger.message.moderateAny←messenger.ts:806/837 (UserRole, NOT ChannelMember.role)
 *
 * CRM scope: crm.scope.own and crm.scope.all are mutually exclusive. ADMIN/PM
 * baseline carries crm.scope.all (org-wide); crm.scope.own is never a baseline
 * capability — it arrives only via the crmAccess flag or a custom role.
 */

// PM: everything an ADMIN can do at the org level EXCEPT admin-only surfaces.
const PM_CAPS: CapabilityKey[] = [
  'project.create',
  'project.viewAll',
  'task.delete',
  'task.staff',
  'task.review.close',
  'task.testing.close',
  'task.checklist.toggle',
  'crm.view',
  'crm.edit',
  'crm.scope.all',
  'servicedesk.viewQueue',
  'servicedesk.workTickets',
  'reports.view',
  'reports.teamScope',
  'reports.viewTeamTime',
  'settings.view',
  'settings.spaces.manage',
  'team.view',
  'team.manageRoster',
  'integrations.bitrix24.syncTeam',
  'integrations.telegram.view',
  'meetings.calendar.teamScope',
];

const MEMBER_CAPS: CapabilityKey[] = ['servicedesk.workTickets', 'reports.view'];

// ADMIN: every catalog key EXCEPT crm.scope.own (ADMIN is crm.scope.all).
const ADMIN_CAPS: CapabilityKey[] = CAPABILITY_KEYS.filter((k) => k !== 'crm.scope.own');

export const BASELINE_CAPS: Record<UserRole, ReadonlySet<CapabilityKey>> = {
  ADMIN: new Set(ADMIN_CAPS),
  PM: new Set(PM_CAPS),
  MEMBER: new Set(MEMBER_CAPS),
  VIEWER: new Set<CapabilityKey>(),
};
