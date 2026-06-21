import type { BxTask } from './types';

/**
 * Bitrix REST returns ids as JSON numbers or strings depending on the
 * field and endpoint. Coerce to a clean string id, treating `0`/empty
 * as absent. Returns null for missing/zero ids so Prisma String? fields
 * never receive an Int (which throws "Expected String or Null").
 */
export function normalizeBitrixId(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s && s !== '0' ? s : null;
}

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
  tags: string[];
  /** Newer "collab" tasks: IM-messenger chat id for discussions. */
  bitrixChatId: string | null;
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
    tags: Array.isArray(t.tags)
      ? t.tags.map((s) => String(s).trim()).filter(Boolean)
      : [],
    bitrixChatId: normalizeBitrixId(t.chatId),
  };
}

/**
 * Bitrix descriptions/comments ship with a HTML+BBCode mix. We convert
 * the readable subset into Markdown so the UI's renderRichText keeps
 * lists, mentions, quotes, links, and bold/italic visible — instead
 * of stripping them and showing a wall of run-on text.
 *
 * Order matters: we process BBCode tags before the generic HTML
 * stripper because Bitrix sometimes nests bbcode inside <p>.
 */
export function stripBitrixHtml(s: string): string {
  return convertBitrixMarkup(s).slice(0, 50_000);
}

/**
 * Bitrix portal timezone. The mirrored portal (since-b24-ru) is Russian, so
 * `[TIMESTAMP=…]` epoch values render in Moscow time to match what users see
 * in Bitrix itself. If we ever mirror a portal in another zone this should
 * move to config, but a single hardcoded zone is correct for the only portal
 * we sync today.
 */
const BITRIX_PORTAL_TZ = 'Europe/Moscow';

/** True for http(s)/protocol-relative URLs; false for Bitrix-internal paths. */
function isAbsoluteUrl(u: string): boolean {
  return /^(https?:)?\/\//i.test(u) || /^https?:/i.test(u);
}

/**
 * Format a Bitrix `[TIMESTAMP=<unix> FORMAT=<fmt>]` tag. Bitrix puts the epoch
 * in the attribute and renders it client-side, so a naive tag-strip loses the
 * value entirely (the deadline/date becomes a stray ", "). We re-render it:
 * *_TIME_* formats → HH:MM, everything else → DD.MM.YYYY.
 */
function formatBitrixTimestamp(unix: string, fmt: string | undefined): string {
  const secs = Number(unix);
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const d = new Date(secs * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const isTime = /TIME/i.test(fmt ?? '');
  try {
    return new Intl.DateTimeFormat(
      'ru-RU',
      isTime
        ? { timeZone: BITRIX_PORTAL_TZ, hour: '2-digit', minute: '2-digit' }
        : {
            timeZone: BITRIX_PORTAL_TZ,
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          },
    ).format(d);
  } catch {
    return '';
  }
}

export function convertBitrixMarkup(s: string): string {
  let out = s;

  // ---------- BBCode → Markdown ----------

  // [USER=123]Иван Иванов[/USER] → @Иван Иванов  (drop the id, keep the
  // human name; matches how mentions render in Bitrix UI).
  out = out.replace(
    /\[USER=\d+\]([\s\S]*?)\[\/USER\]/gi,
    (_m, name) => `@${name.trim()}`,
  );

  // [TIMESTAMP=<unix> FORMAT=<fmt>] → readable date/time. MUST run before the
  // [URL] pass below, because system messages nest these inside the link label
  // (e.g. "… на [URL=…][TIMESTAMP …], [TIMESTAMP …][/URL]"). Without this the
  // catch-all strips the tag and the date vanishes.
  out = out.replace(
    /\[TIMESTAMP=(\d+)(?:\s+FORMAT=([A-Z0-9_]+))?\]/gi,
    (_m, unix, fmt) => formatBitrixTimestamp(unix, fmt),
  );

  // [URL=link]label[/URL]. Bitrix system/action messages link to RELATIVE
  // portal paths (/workgroups/…/?chatAction=…) that are meaningless outside
  // Bitrix — drop the link wrapper, keep just the (now formatted) label.
  // Only ABSOLUTE http(s) links become markdown links (the renderer resolves
  // those). Bare [URL]url[/URL] → url for absolute, dropped for relative.
  out = out.replace(
    /\[URL=([^\]]+)\]([\s\S]*?)\[\/URL\]/gi,
    (_m, url, label) => {
      const u = String(url).trim();
      const l = String(label).trim();
      if (!isAbsoluteUrl(u)) return l;
      return `[${l}](${u})`;
    },
  );
  out = out.replace(/\[URL\]([\s\S]*?)\[\/URL\]/gi, (_m, url) => {
    const u = String(url).trim();
    return isAbsoluteUrl(u) ? u : '';
  });

  // Inline emphasis.
  out = out.replace(/\[B\]([\s\S]*?)\[\/B\]/gi, (_m, t) => `**${t}**`);
  out = out.replace(/\[I\]([\s\S]*?)\[\/I\]/gi, (_m, t) => `*${t}*`);
  out = out.replace(/\[U\]([\s\S]*?)\[\/U\]/gi, (_m, t) => `_${t}_`);
  out = out.replace(/\[S\]([\s\S]*?)\[\/S\]/gi, (_m, t) => `~~${t}~~`);

  // Code: [CODE]...[/CODE] → fenced triple-backtick.
  out = out.replace(
    /\[CODE\]([\s\S]*?)\[\/CODE\]/gi,
    (_m, t) => `\n\`\`\`\n${t}\n\`\`\`\n`,
  );

  // Quote: [QUOTE]...[/QUOTE] → > line (one-level only; nested quotes
  // get the same prefix and look fine in the renderer).
  out = out.replace(/\[QUOTE\]([\s\S]*?)\[\/QUOTE\]/gi, (_m, t) =>
    t
      .split('\n')
      .map((line: string) => `> ${line}`)
      .join('\n'),
  );

  // Lists: [LIST]…[*]item…[/LIST]  → bullet markdown.
  out = out.replace(/\[LIST\]([\s\S]*?)\[\/LIST\]/gi, (_m, body: string) =>
    body
      .split('[*]')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `- ${s}`)
      .join('\n'),
  );

  // Color tag carries no markdown equivalent — strip it but keep
  // the inner text so we don't lose content.
  out = out.replace(/\[COLOR(?:=[^\]]+)?\]([\s\S]*?)\[\/COLOR\]/gi, (_m, t) => t);

  // Catch-all for any leftover BBCode pair we didn't model.
  out = out.replace(/\[\/?[A-Z]+(?:=[^\]]*)?\]/gi, '');

  // ---------- HTML cleanup ----------

  // Convert links and emphasis tags before stripping the rest.
  out = out.replace(
    /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, url, label) => `[${label.trim()}](${url.trim()})`,
  );
  out = out.replace(/<\/?(?:b|strong)>/gi, '**');
  out = out.replace(/<\/?(?:i|em)>/gi, '*');
  out = out.replace(/<br\s*\/?>(\r?\n)?/gi, '\n');
  out = out.replace(/<\/p>/gi, '\n\n');
  out = out.replace(/<li[^>]*>/gi, '\n- ');
  out = out.replace(/<\/li>/gi, '');
  out = out.replace(/<\/?(?:ul|ol)[^>]*>/gi, '');
  out = out.replace(/<[^>]+>/g, '');

  // ---------- entities & whitespace ----------
  out = out
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return out;
}
