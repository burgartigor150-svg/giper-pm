/**
 * Capability catalog — the frozen vocabulary of ORG-LEVEL permissions a custom
 * role can grant or withhold. Each key maps to exactly one org-level decision
 * the code already makes (a permission helper or an inline `role===` literal).
 *
 * v1 covers ONLY org-level levers. Hard per-stake/visibility floors
 * (canViewProject, canViewTask, the listProjectsForUser per-stake OR, the CRM
 * owner clamp) are deliberately NOT in the catalog — they can never be widened
 * by a capability. See lib/capabilities/floors.ts and the design notes.
 */

export const CAPABILITY_KEYS = [
  // ── Projects ──
  'project.create',
  'project.viewAll', // honor scope:'all' org-wide browse (never edits the per-stake OR)
  'project.edit',
  // ── Tasks (org-level levers only) ──
  'task.delete',
  'task.staff',
  'task.editAny',
  'task.review.close',
  'task.checklist.toggle',
  'task.attachments.manageAny',
  'task.tags.assign',
  // ── CRM ──
  'crm.view',
  'crm.edit',
  'crm.scope.own', // scoped sales rep — keeps the ownerFilter where:{ownerId} ON
  'crm.scope.all', // org-wide CRM — grantable only from an ADMIN/PM template
  'crm.pipeline.destroy',
  // ── Service desk ──
  'servicedesk.viewQueue',
  'servicedesk.workTickets',
  // ── Reports ──
  'reports.view',
  'reports.teamScope',
  'reports.viewTeamTime',
  'reports.viewScreenshots',
  // ── Settings / Admin ──
  'settings.view',
  'settings.spaces.manage',
  'settings.users.manage',
  'settings.audit.view',
  'settings.groups.manage',
  'settings.positions.manage',
  'settings.tags.manageOrg',
  'settings.roles.manage',
  // ── Team / Users ──
  'users.create',
  'users.update',
  'users.resetPassword',
  'users.setActive',
  'team.view',
  'team.manageRoster',
  // ── Integrations ──
  'integrations.bitrix24.config',
  'integrations.bitrix24.syncNow',
  'integrations.bitrix24.syncTeam',
  'integrations.telegram.view',
  'integrations.telegramBots.manageAny',
  // ── Meetings ──
  'meetings.viewAny',
  'meetings.manageAny',
  'meetings.calendar.teamScope',
  // ── Messenger (org admin) ──
  'messenger.message.moderateAny',
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

/** Fast membership test — the resolver uses it to drop junk/unknown keys. */
export const CATALOG_KEYS: ReadonlySet<string> = new Set(CAPABILITY_KEYS);

export function isCapabilityKey(k: string): k is CapabilityKey {
  return CATALOG_KEYS.has(k);
}

/**
 * Capabilities that are dangerous to grant to a non-privileged base role —
 * surfaced with a warning in the admin role builder (slice 3). Not a security
 * boundary by itself (the floor clamp + per-template rules are); a UX guardrail.
 */
export const HIGH_TRUST_CAPS: ReadonlySet<CapabilityKey> = new Set<CapabilityKey>([
  'project.viewAll',
  'crm.scope.all',
  'crm.pipeline.destroy',
  'settings.view',
  'settings.users.manage',
  'settings.audit.view',
  'settings.groups.manage',
  'settings.positions.manage',
  'settings.tags.manageOrg',
  'settings.roles.manage',
  'users.create',
  'users.update',
  'users.resetPassword',
  'users.setActive',
  'integrations.bitrix24.config',
  'integrations.bitrix24.syncNow',
  'integrations.telegramBots.manageAny',
  'meetings.viewAny',
  'meetings.manageAny',
  'messenger.message.moderateAny',
]);

/** Grouped view for the admin role builder (slice 3). Labels are ru. */
export type CapabilityGroup = {
  area: string;
  capabilities: { key: CapabilityKey; label: string }[];
};

export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    area: 'Проекты',
    capabilities: [
      { key: 'project.create', label: 'Создавать проекты' },
      { key: 'project.viewAll', label: 'Видеть все проекты (не только свои)' },
      { key: 'project.edit', label: 'Редактировать любой проект' },
    ],
  },
  {
    area: 'Задачи',
    capabilities: [
      { key: 'task.delete', label: 'Удалять задачи' },
      { key: 'task.staff', label: 'Назначать исполнителей/ревьюеров' },
      { key: 'task.editAny', label: 'Редактировать любую задачу' },
      { key: 'task.review.close', label: 'Закрывать ревью' },
      { key: 'task.checklist.toggle', label: 'Управлять чек-листами' },
      { key: 'task.attachments.manageAny', label: 'Управлять любыми вложениями' },
      { key: 'task.tags.assign', label: 'Назначать теги' },
    ],
  },
  {
    area: 'CRM',
    capabilities: [
      { key: 'crm.view', label: 'Видеть CRM' },
      { key: 'crm.edit', label: 'Редактировать CRM' },
      { key: 'crm.scope.own', label: 'Только свои записи CRM' },
      { key: 'crm.scope.all', label: 'Весь CRM организации' },
      { key: 'crm.pipeline.destroy', label: 'Архивировать воронки' },
    ],
  },
  {
    area: 'Сервис-деск',
    capabilities: [
      { key: 'servicedesk.viewQueue', label: 'Видеть очередь тикетов' },
      { key: 'servicedesk.workTickets', label: 'Работать с тикетами' },
    ],
  },
  {
    area: 'Отчёты',
    capabilities: [
      { key: 'reports.view', label: 'Видеть отчёты' },
      { key: 'reports.teamScope', label: 'Отчёты по команде' },
      { key: 'reports.viewTeamTime', label: 'Время команды' },
      { key: 'reports.viewScreenshots', label: 'Скриншоты команды' },
    ],
  },
  {
    area: 'Настройки / Админ',
    capabilities: [
      { key: 'settings.view', label: 'Видеть настройки' },
      { key: 'settings.spaces.manage', label: 'Управлять пространствами' },
      { key: 'settings.users.manage', label: 'Управлять пользователями' },
      { key: 'settings.audit.view', label: 'Журнал аудита' },
      { key: 'settings.groups.manage', label: 'Управлять группами' },
      { key: 'settings.positions.manage', label: 'Управлять должностями' },
      { key: 'settings.tags.manageOrg', label: 'Удалять теги организации' },
      { key: 'settings.roles.manage', label: 'Управлять ролями' },
    ],
  },
  {
    area: 'Команда / Пользователи',
    capabilities: [
      { key: 'users.create', label: 'Создавать пользователей' },
      { key: 'users.update', label: 'Редактировать пользователей' },
      { key: 'users.resetPassword', label: 'Сбрасывать пароли' },
      { key: 'users.setActive', label: 'Активировать/деактивировать' },
      { key: 'team.view', label: 'Видеть рабочее пространство команды' },
      { key: 'team.manageRoster', label: 'Управлять составом команды' },
    ],
  },
  {
    area: 'Интеграции',
    capabilities: [
      { key: 'integrations.bitrix24.config', label: 'Настройка Bitrix24' },
      { key: 'integrations.bitrix24.syncNow', label: 'Синхронизация Bitrix24' },
      { key: 'integrations.bitrix24.syncTeam', label: 'Синхронизация команды Bitrix24' },
      { key: 'integrations.telegram.view', label: 'Telegram-интеграция' },
      { key: 'integrations.telegramBots.manageAny', label: 'Управлять любыми Telegram-ботами' },
    ],
  },
  {
    area: 'Созвоны',
    capabilities: [
      { key: 'meetings.viewAny', label: 'Видеть любые созвоны' },
      { key: 'meetings.manageAny', label: 'Управлять любыми созвонами' },
      { key: 'meetings.calendar.teamScope', label: 'Календарь команды' },
    ],
  },
  {
    area: 'Мессенджер',
    capabilities: [
      { key: 'messenger.message.moderateAny', label: 'Модерировать любые сообщения' },
    ],
  },
];
