import type { PrismaClient } from '@giper/db';
import { Bitrix24Client } from './client';

/**
 * Sync the task's "system events" (history) from Bitrix24 into local
 * Comment rows so they show up alongside regular comments in the task
 * timeline — same as how Bitrix UI mixes both feeds.
 *
 * Bitrix splits a task's activity into two collections:
 *   - `task.commentitem.getlist` — human comments (POST_MESSAGE)
 *   - `tasks.task.history.list`   — system events: status changes,
 *     deadline edits, responsible/auditor reassignments, ...
 *
 * The legacy single-comments list misses everything in the second
 * collection, which is what users notice as "missing recent activity"
 * on tasks where the only changes for months are deadline pushes or
 * watcher edits.
 *
 * Storage model: each history event becomes a Comment row with
 *   source='WEB', visibility='EXTERNAL',
 *   externalSource='bitrix24', externalId='hist:<historyId>'
 * The 'hist:' prefix lets the inbound dedupe path (which keys on the
 * raw bitrix comment id) coexist with these without collisions.
 *
 * Author resolution: same as syncTaskComments — match by bitrixUserId,
 * fall back to the first ADMIN.
 */

export type SyncHistoryResult = {
  totalSeen: number;
  created: number;
  updated: number;
  errors: number;
};

type BxHistoryItem = {
  id: number;
  createdDate: string;
  field: string;
  value?: { from?: unknown; to?: unknown } | null;
  user?: {
    id: number | string;
    name?: string;
    lastName?: string;
  };
};

export async function syncTaskHistory(
  prisma: PrismaClient,
  client: Bitrix24Client,
  task: { id: string; bitrixTaskId: string },
  stats: SyncHistoryResult,
): Promise<void> {
  let items: BxHistoryItem[];
  try {
    const res = await client.call<{ list?: BxHistoryItem[] }>(
      'tasks.task.history.list',
      { taskId: task.bitrixTaskId },
    );
    items = res.result?.list ?? [];
  } catch (e) {
    stats.errors++;
    // eslint-disable-next-line no-console
    console.error('bitrix24 syncHistory: failed for', task.bitrixTaskId, e);
    return;
  }

  // Resolve User name lookup once per task — used for resolving ids
  // referenced inside DEADLINE/RESPONSIBLE/AUDITORS/ACCOMPLICES values.
  const referencedIds = new Set<string>();
  for (const it of items) {
    if (it.user?.id) referencedIds.add(String(it.user.id));
    pushUserIdsFromValue(it.field, it.value, referencedIds);
  }
  const localUsers = referencedIds.size
    ? await prisma.user.findMany({
        where: { bitrixUserId: { in: [...referencedIds] } },
        select: { id: true, name: true, bitrixUserId: true },
      })
    : [];
  const nameByBxId = new Map(
    localUsers
      .filter((u): u is typeof u & { bitrixUserId: string } => !!u.bitrixUserId)
      .map((u) => [u.bitrixUserId, u.name]),
  );

  const adminFallback = await prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!adminFallback) return;

  for (const it of items) {
    stats.totalSeen++;
    try {
      const bxAuthorId = it.user?.id ? String(it.user.id) : null;
      const localAuthor = bxAuthorId
        ? await prisma.user.findFirst({
            where: { bitrixUserId: bxAuthorId },
            select: { id: true },
          })
        : null;
      const authorId = localAuthor?.id ?? adminFallback.id;

      const body = renderHistoryEvent(it, nameByBxId);
      if (!body) continue; // event we can't usefully render → skip

      const externalId = `hist:${it.id}`;
      const createdAt = it.createdDate ? new Date(it.createdDate) : new Date();

      const existing = await prisma.comment.findUnique({
        where: {
          externalSource_externalId: {
            externalSource: 'bitrix24',
            externalId,
          },
        },
        select: { id: true, body: true },
      });
      if (existing) {
        if (existing.body !== body) {
          await prisma.comment.update({
            where: { id: existing.id },
            data: { body },
          });
          stats.updated++;
        }
        continue;
      }

      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId,
          body,
          source: 'WEB',
          visibility: 'EXTERNAL',
          externalSource: 'bitrix24',
          externalId,
          createdAt,
        },
      });
      stats.created++;
    } catch (e) {
      stats.errors++;
      // eslint-disable-next-line no-console
      console.error('bitrix24 syncHistory: upsert failed for', it.id, e);
    }
  }
}

function pushUserIdsFromValue(
  field: string,
  value: { from?: unknown; to?: unknown } | null | undefined,
  out: Set<string>,
) {
  if (!value) return;
  const userFields = new Set([
    'RESPONSIBLE_ID',
    'CREATED_BY',
    'AUDITORS',
    'ACCOMPLICES',
  ]);
  if (!userFields.has(field)) return;
  for (const side of [value.from, value.to]) {
    if (side == null) continue;
    const s = String(side);
    for (const id of s.split(',').map((x) => x.trim()).filter(Boolean)) {
      out.add(id);
    }
  }
}

const STATUS_RU: Record<string, string> = {
  '1': 'Новая',
  '2': 'К выполнению',
  '3': 'Выполняется',
  '4': 'На контроле',
  '5': 'Завершена',
  '6': 'Отложена',
  '7': 'Отклонена',
};

const PRIORITY_RU: Record<string, string> = {
  '0': 'Низкий',
  '1': 'Обычный',
  '2': 'Высокий',
};

function fmtTs(v: unknown): string {
  if (v == null || v === '') return '—';
  // Bitrix sends unix-seconds as strings for DEADLINE / dates.
  const n = Number(v);
  if (Number.isFinite(n) && n > 1_000_000_000) {
    return new Date(n * 1000).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  // Sometimes ISO strings.
  if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  }
  return String(v);
}

function fmtUserList(
  csv: unknown,
  nameByBxId: Map<string, string>,
): string {
  if (csv == null || csv === '') return '—';
  return String(csv)
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => nameByBxId.get(id) ?? `Bitrix #${id}`)
    .join(', ');
}

function renderHistoryEvent(
  it: BxHistoryItem,
  nameByBxId: Map<string, string>,
): string | null {
  const value = it.value ?? {};
  const from = (value as { from?: unknown }).from;
  const to = (value as { to?: unknown }).to;

  switch (it.field) {
    case 'NEW':
      return '➕ Создана задача';
    case 'STATUS': {
      const a = STATUS_RU[String(from ?? '')] ?? String(from ?? '—');
      const b = STATUS_RU[String(to ?? '')] ?? String(to ?? '—');
      return `🔄 Статус: ${a} → ${b}`;
    }
    case 'PRIORITY': {
      const a = PRIORITY_RU[String(from ?? '')] ?? String(from ?? '—');
      const b = PRIORITY_RU[String(to ?? '')] ?? String(to ?? '—');
      return `⚡ Приоритет: ${a} → ${b}`;
    }
    case 'DEADLINE':
    case 'END_DATE_PLAN':
      return `⏰ Дедлайн: ${fmtTs(from)} → ${fmtTs(to)}`;
    case 'START_DATE_PLAN':
      return `▶️ Старт по плану: ${fmtTs(from)} → ${fmtTs(to)}`;
    case 'CLOSED_DATE':
      return `✅ Закрыта: ${fmtTs(to)}`;
    case 'TITLE':
      return `📝 Название: «${String(from ?? '—')}» → «${String(to ?? '—')}»`;
    case 'DESCRIPTION':
      return '📝 Изменено описание';
    case 'RESPONSIBLE_ID':
      return `👤 Исполнитель: ${fmtUserList(from, nameByBxId)} → ${fmtUserList(to, nameByBxId)}`;
    case 'AUDITORS':
      return `👀 Наблюдатели: ${fmtUserList(to, nameByBxId)}`;
    case 'ACCOMPLICES':
      return `🤝 Соисполнители: ${fmtUserList(to, nameByBxId)}`;
    case 'GROUP_ID':
      return `📁 Группа: ${String(from ?? '—')} → ${String(to ?? '—')}`;
    case 'TAGS':
      return `🏷 Теги: ${String(to ?? '—')}`;
    case 'PARENT_ID':
      return `🔗 Родительская задача: ${String(to ?? '—')}`;
    case 'TIME_ESTIMATE':
      return `⏱ Оценка: ${String(from ?? '—')} → ${String(to ?? '—')} мин`;
    case 'COMMENT':
      // The history list also references comments — they're the
      // POST_MESSAGE rows we already sync via syncTaskComments,
      // skip them here to avoid duplicates.
      return null;
    default:
      // Generic catch-all so we don't silently drop unknown events.
      return `🔧 ${it.field}: ${String(from ?? '—')} → ${String(to ?? '—')}`;
  }
}
