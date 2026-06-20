import type { UserRole } from '@giper/db';
import { CAPABILITY_KEYS, type CapabilityKey } from './catalog';

/**
 * BASELINE_CAPS — today's org permission matrix encoded as data, one Set per
 * UserRole. This is the SINGLE source for "what a user with no custom role can
 * do at the org level". It is asserted equal to the live permission helpers /
 * inline literals for every (role, key) pair by capabilities.test.ts — that
 * golden parity test is the merge gate for this slice and catches any drift.
 *
 * Note on CRM scope: crm.scope.own and crm.scope.all are mutually exclusive.
 * ADMIN/PM baseline carries crm.scope.all (org-wide). crm.scope.own is never a
 * baseline capability — it arrives only via the crmAccess flag or a custom role.
 */

// PM: everything an ADMIN can do at the org level EXCEPT admin-only surfaces.
const PM_CAPS: CapabilityKey[] = [
  'project.create',
  'project.viewAll',
  'task.delete',
  'task.staff',
  'task.review.close',
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
