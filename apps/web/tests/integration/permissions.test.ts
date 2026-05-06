import { describe, it, expect } from 'vitest';
import type { UserRole, MemberRole } from '@giper/db';
import {
  canCreateProject,
  canEditProject,
  canViewProject,
  canCreateTask,
  canEditTask,
  canViewTask,
  canDeleteTask,
  canViewUserTime,
  canEditTimeEntry,
  canViewUserActivity,
  canViewUserScreenshots,
  canSeeReports,
  canSeeSettings,
  type SessionUser,
  type ProjectForPerm,
  type TaskForPerm,
} from '@/lib/permissions';

// All permission helpers are pure / synchronous. We don't actually need the
// DB but the integration suite is the central place we run them — keeping them
// here verifies the module loads in the same env as the use-cases.

const roles: UserRole[] = ['ADMIN', 'PM', 'MEMBER', 'VIEWER'];
const memberRoles: MemberRole[] = ['LEAD', 'CONTRIBUTOR', 'REVIEWER', 'OBSERVER'];

const u = (role: UserRole, id = `u-${role}`): SessionUser => ({ id, role });

const project = (
  ownerId: string,
  members: { userId: string; role: MemberRole }[] = [],
): ProjectForPerm => ({ ownerId, members });

const task = (over: Partial<TaskForPerm> & { project: ProjectForPerm }): TaskForPerm => ({
  creatorId: over.creatorId ?? 'u-creator',
  assigneeId: over.assigneeId ?? null,
  project: over.project,
});

describe('canCreateProject', () => {
  it.each([
    ['ADMIN', true],
    ['PM', true],
    ['MEMBER', false],
    ['VIEWER', false],
  ] as const)('role %s → %s', (role, expected) => {
    expect(canCreateProject(u(role))).toBe(expected);
  });
});

describe('canEditProject', () => {
  it('ADMIN can edit any project (not owner, not member)', () => {
    const p = project('someone-else');
    expect(canEditProject(u('ADMIN', 'admin-1'), p)).toBe(true);
  });

  it('owner can edit', () => {
    const p = project('owner-1');
    expect(canEditProject(u('MEMBER', 'owner-1'), p)).toBe(true);
  });

  it('LEAD member can edit', () => {
    const p = project('owner-1', [{ userId: 'lead-1', role: 'LEAD' }]);
    expect(canEditProject(u('MEMBER', 'lead-1'), p)).toBe(true);
  });

  it.each(['CONTRIBUTOR', 'REVIEWER', 'OBSERVER'] as MemberRole[])(
    '%s member cannot edit',
    (mr) => {
      const p = project('owner-1', [{ userId: 'm-1', role: mr }]);
      expect(canEditProject(u('MEMBER', 'm-1'), p)).toBe(false);
    },
  );

  it('PM that is neither owner nor LEAD cannot edit', () => {
    const p = project('owner-1');
    expect(canEditProject(u('PM', 'pm-stranger'), p)).toBe(false);
  });

  it('random VIEWER cannot edit', () => {
    const p = project('owner-1');
    expect(canEditProject(u('VIEWER', 'viewer-1'), p)).toBe(false);
  });
});

describe('canViewProject', () => {
  it('ADMIN sees any project', () => {
    expect(canViewProject(u('ADMIN', 'a'), project('owner-1'))).toBe(true);
  });

  it('PM sees any project', () => {
    expect(canViewProject(u('PM', 'p'), project('owner-1'))).toBe(true);
  });

  it('owner sees own project', () => {
    expect(canViewProject(u('MEMBER', 'owner-1'), project('owner-1'))).toBe(true);
  });

  it.each(memberRoles)('member with role %s sees project', (mr) => {
    const p = project('owner-1', [{ userId: 'm-1', role: mr }]);
    expect(canViewProject(u('MEMBER', 'm-1'), p)).toBe(true);
  });

  it('non-member MEMBER cannot see', () => {
    const p = project('owner-1', [{ userId: 'other', role: 'CONTRIBUTOR' }]);
    expect(canViewProject(u('MEMBER', 'stranger'), p)).toBe(false);
  });

  it('non-member VIEWER cannot see', () => {
    const p = project('owner-1');
    expect(canViewProject(u('VIEWER', 'stranger'), p)).toBe(false);
  });
});

describe('canCreateTask', () => {
  it('ADMIN can always create', () => {
    expect(canCreateTask(u('ADMIN', 'a'), project('owner-1'))).toBe(true);
  });

  it('PM can always create', () => {
    expect(canCreateTask(u('PM', 'p'), project('owner-1'))).toBe(true);
  });

  it('VIEWER cannot create even if project member', () => {
    const p = project('owner-1', [{ userId: 'v', role: 'CONTRIBUTOR' }]);
    expect(canCreateTask(u('VIEWER', 'v'), p)).toBe(false);
  });

  it('MEMBER who is project member can create', () => {
    const p = project('owner-1', [{ userId: 'm', role: 'CONTRIBUTOR' }]);
    expect(canCreateTask(u('MEMBER', 'm'), p)).toBe(true);
  });

  it('MEMBER who is NOT a project member cannot create', () => {
    const p = project('owner-1');
    expect(canCreateTask(u('MEMBER', 'stranger'), p)).toBe(false);
  });
});

describe('canEditTask', () => {
  it('ADMIN edits any task', () => {
    expect(
      canEditTask(u('ADMIN', 'a'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('creator edits own task', () => {
    expect(
      canEditTask(
        u('MEMBER', 'creator-1'),
        task({ creatorId: 'creator-1', project: project('owner-1') }),
      ),
    ).toBe(true);
  });

  it('assignee edits assigned task', () => {
    expect(
      canEditTask(
        u('MEMBER', 'as-1'),
        task({ assigneeId: 'as-1', project: project('owner-1') }),
      ),
    ).toBe(true);
  });

  it('project owner edits any project task', () => {
    expect(
      canEditTask(u('MEMBER', 'owner-1'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('LEAD member edits any project task', () => {
    const p = project('owner-1', [{ userId: 'l-1', role: 'LEAD' }]);
    expect(canEditTask(u('MEMBER', 'l-1'), task({ project: p }))).toBe(true);
  });

  it('CONTRIBUTOR who is not creator/assignee cannot edit', () => {
    const p = project('owner-1', [{ userId: 'c-1', role: 'CONTRIBUTOR' }]);
    expect(canEditTask(u('MEMBER', 'c-1'), task({ project: p }))).toBe(false);
  });

  it('stranger PM cannot edit (PM has no creator/assignee/lead/owner relation)', () => {
    expect(
      canEditTask(u('PM', 'pm-stranger'), task({ project: project('owner-1') })),
    ).toBe(false);
  });
});

describe('canViewTask', () => {
  it('mirrors canViewProject — ADMIN ok', () => {
    expect(
      canViewTask(u('ADMIN', 'a'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('non-member MEMBER cannot view', () => {
    expect(
      canViewTask(u('MEMBER', 'stranger'), task({ project: project('owner-1') })),
    ).toBe(false);
  });

  it('member can view', () => {
    const p = project('owner-1', [{ userId: 'm-1', role: 'OBSERVER' }]);
    expect(canViewTask(u('MEMBER', 'm-1'), task({ project: p }))).toBe(true);
  });
});

describe('canDeleteTask', () => {
  it('ADMIN deletes any', () => {
    expect(
      canDeleteTask(u('ADMIN', 'a'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('PM deletes any', () => {
    expect(
      canDeleteTask(u('PM', 'p'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('project owner can delete', () => {
    expect(
      canDeleteTask(u('MEMBER', 'owner-1'), task({ project: project('owner-1') })),
    ).toBe(true);
  });

  it('LEAD can delete', () => {
    const p = project('owner-1', [{ userId: 'l-1', role: 'LEAD' }]);
    expect(canDeleteTask(u('MEMBER', 'l-1'), task({ project: p }))).toBe(true);
  });

  it('creator without LEAD/owner cannot delete', () => {
    expect(
      canDeleteTask(
        u('MEMBER', 'creator-1'),
        task({ creatorId: 'creator-1', project: project('owner-1') }),
      ),
    ).toBe(false);
  });

  it('CONTRIBUTOR cannot delete', () => {
    const p = project('owner-1', [{ userId: 'c-1', role: 'CONTRIBUTOR' }]);
    expect(canDeleteTask(u('MEMBER', 'c-1'), task({ project: p }))).toBe(false);
  });

  it('VIEWER cannot delete', () => {
    expect(
      canDeleteTask(u('VIEWER', 'v'), task({ project: project('owner-1') })),
    ).toBe(false);
  });
});

describe('canViewUserTime', () => {
  it('viewing own time always allowed', () => {
    expect(canViewUserTime(u('VIEWER', 'self'), { id: 'self' })).toBe(true);
  });

  it.each([
    ['ADMIN', true],
    ['PM', true],
    ['MEMBER', false],
    ['VIEWER', false],
  ] as const)('viewer role %s viewing other → %s', (role, expected) => {
    expect(canViewUserTime(u(role, 'self'), { id: 'other' })).toBe(expected);
  });
});

describe('canEditTimeEntry', () => {
  it('user edits own entry', () => {
    expect(canEditTimeEntry(u('MEMBER', 'me'), { userId: 'me' })).toBe(true);
  });

  it.each([
    ['ADMIN', true],
    ['PM', true],
    ['MEMBER', false],
    ['VIEWER', false],
  ] as const)('role %s editing someone else’s entry → %s', (role, expected) => {
    expect(canEditTimeEntry(u(role, 'me'), { userId: 'other' })).toBe(expected);
  });
});

describe('canViewUserActivity', () => {
  it.each(roles)('only owner can view (role %s viewing self → true)', (role) => {
    expect(canViewUserActivity(u(role, 'self'), { id: 'self' })).toBe(true);
  });

  it.each(roles)('role %s viewing other → false', (role) => {
    expect(canViewUserActivity(u(role, 'self'), { id: 'other' })).toBe(false);
  });
});

describe('canViewUserScreenshots', () => {
  it('owner sees own', () => {
    expect(
      canViewUserScreenshots(u('MEMBER', 'self'), { id: 'self' }),
    ).toBe(true);
  });

  it('PM sees only direct reports', () => {
    expect(
      canViewUserScreenshots(u('PM', 'pm-1'), { id: 'sub', pmId: 'pm-1' }),
    ).toBe(true);
  });

  it('PM does NOT see screenshots if not direct PM', () => {
    expect(
      canViewUserScreenshots(u('PM', 'pm-other'), { id: 'sub', pmId: 'pm-1' }),
    ).toBe(false);
  });

  it('ADMIN with reviewConsent=true → ok', () => {
    expect(
      canViewUserScreenshots(u('ADMIN', 'a'), { id: 'sub' }, true),
    ).toBe(true);
  });

  it('ADMIN without reviewConsent → false', () => {
    expect(
      canViewUserScreenshots(u('ADMIN', 'a'), { id: 'sub' }, false),
    ).toBe(false);
  });

  it('MEMBER cannot view someone else regardless of consent', () => {
    expect(
      canViewUserScreenshots(u('MEMBER', 'm'), { id: 'sub' }, true),
    ).toBe(false);
  });

  it('VIEWER cannot view someone else', () => {
    expect(
      canViewUserScreenshots(u('VIEWER', 'v'), { id: 'sub' }, true),
    ).toBe(false);
  });
});

describe('canSeeReports', () => {
  it.each([
    ['ADMIN', true],
    ['PM', true],
    ['MEMBER', true],
    ['VIEWER', false],
  ] as const)('role %s → %s', (role, expected) => {
    expect(canSeeReports(u(role))).toBe(expected);
  });
});

describe('canSeeSettings', () => {
  it.each([
    ['ADMIN', true],
    ['PM', true],
    ['MEMBER', false],
    ['VIEWER', false],
  ] as const)('role %s → %s', (role, expected) => {
    expect(canSeeSettings(u(role))).toBe(expected);
  });
});
