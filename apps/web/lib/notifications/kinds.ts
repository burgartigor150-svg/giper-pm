import type { NotificationKind } from '@giper/db';

/**
 * The notification categories a user can mute, with Russian labels. Single
 * source of truth shared by the preferences form (rendering) and the action
 * (validation). Keep in sync with the NotificationKind enum.
 */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  TASK_ASSIGNED: 'Назначена задача',
  TASK_COMMENTED: 'Комментарий к задаче',
  TASK_STATUS_CHANGED: 'Смена статуса задачи',
  TIME_DISCREPANCY: 'Расхождение по времени',
  TIME_CONFIRMATION: 'Подтверждение времени',
  DEADLINE_APPROACHING: 'Приближается дедлайн',
  DEADLINE_PASSED: 'Просрочен дедлайн',
  MENTION: 'Упоминание в задаче',
  CHAT_MENTION: 'Упоминание в чате',
  CHAT_DM: 'Личное сообщение',
  CALL_INVITE: 'Приглашение на звонок',
  SYSTEM: 'Системные',
};

export const NOTIFICATION_KINDS = Object.keys(
  NOTIFICATION_KIND_LABELS,
) as NotificationKind[];
