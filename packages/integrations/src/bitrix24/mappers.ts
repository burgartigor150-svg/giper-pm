import type { BxTask } from './types';

/** Bitrix24 task status (1..7) → our TaskStatus.
 *
 *  1 — Новая          → TODO
 *  2 — Ждет выполнения → TODO
 *  3 — Выполняется    → IN_PROGRESS
 *  4 — Завершена (ожидает контроля) → REVIEW
 *  5 — Завершена      → DONE
 *  6 — Отложена       → BACKLOG
 *  7 — Отказано       → CANCELED
 */
export type DomainTaskStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'BLOCKED'
  | 'DONE'
  | 'CANCELED';

const STATUS_MAP: Record<string, DomainTaskStatus> = {
  '1': 'TODO',
  '2': 'TODO',
  '3': 'IN_PROGRESS',
  '4': 'REVIEW',
  '5': 'DONE',
  '6': 'BACKLOG',
  '7': 'CANCELED',
};

export function mapBitrixStatus(s: string | undefined): DomainTaskStatus {
  return STATUS_MAP[String(s ?? '')] ?? 'TODO';
}

/** Bitrix priority (0/1/2) → our TaskPriority. We don't expose URGENT. */
export type DomainTaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export function mapBitrixPriority(p: string | undefined): DomainTaskPriority {
  switch (String(p ?? '')) {
    case '0':
      return 'LOW';
    case '2':
      return 'HIGH';
    default:
      return 'MEDIUM';
  }
}

/** Convert "2026-05-06T19:35:54+03:00" / undefined / null / '' → Date | null. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type DomainTaskFromBitrix = {
  externalId: string;
  externalSource: 'bitrix24';
  title: string;
  description: string | null;
  status: DomainTaskStatus;
  priority: DomainTaskPriority;
  bitrixGroupId: string | null;
  bitrixResponsibleId: string | null;
  bitrixCreatedById: string | null;
  dueDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  externalUpdatedAt: Date | null;
};

export function mapBitrixTask(t: BxTask): DomainTaskFromBitrix {
  const status = mapBitrixStatus(t.status);
  return {
    externalId: t.id,
    externalSource: 'bitrix24',
    title: (t.title ?? 'Без названия').slice(0, 200),
    description: t.description ? stripBitrixHtml(t.description) : null,
    status,
    priority: mapBitrixPriority(t.priority),
    bitrixGroupId: t.groupId && t.groupId !== '0' ? t.groupId : null,
    bitrixResponsibleId: t.responsibleId ?? null,
    bitrixCreatedById: t.createdBy ?? null,
    dueDate: parseDate(t.deadline),
    startedAt: parseDate(t.startDatePlan),
    completedAt: status === 'DONE' ? parseDate(t.closedDate) : null,
    externalUpdatedAt: parseDate(t.changedDate),
  };
}

/**
 * Bitrix descriptions ship with a tiny HTML/BBCode subset. We strip just the
 * common tags so the description is readable in plain-text form. A full
 * markdown renderer is overkill for a read-only mirror.
 */
export function stripBitrixHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
    .slice(0, 20000);
}
