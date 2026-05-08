import { Avatar } from '@giper/ui/components/Avatar';
import { ExternalLink } from 'lucide-react';
import { TaskStatusBadge } from './TaskStatusBadge';
import { renderRichText } from '@/lib/text/renderRichText';
import type { TaskStatus, TaskPriority } from '@giper/db';

type Person = { id: string; name: string; image: string | null };

type Props = {
  /** Bitrix-mirrored status — what the client sees in Bitrix. */
  status: TaskStatus;
  /** Bitrix-mirrored assignee — round-trips through to Bitrix. */
  assignee: Person | null;
  /** Bitrix description — BBCode/HTML, plain-text safe via renderRichText. */
  description: string | null;
  /** CREATED_BY in Bitrix. */
  creator: Person | null;
  /** Priority mirrored from Bitrix (LOW/MEDIUM/HIGH/URGENT). */
  priority: TaskPriority | null;
  /** Deadline (DEADLINE). */
  dueDate: Date | string | null;
  /** Plan start (START_DATE_PLAN). */
  startedAt: Date | string | null;
  /** Closure timestamp (CLOSED_DATE). */
  completedAt: Date | string | null;
  /** Bitrix task id for the deep link. */
  externalId: string | null;
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  URGENT: 'Срочно',
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  LOW: 'bg-slate-400',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-amber-500',
  URGENT: 'bg-red-500',
};

const BITRIX_BASE = 'https://giper.bitrix24.ru';

function fmt(d: Date | string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU');
}

/**
 * Read-only summary of the Bitrix-mirrored fields. Shown only on
 * tasks where externalSource === 'bitrix24'. Mirrors the upstream
 * task card: title comes from the page header, this panel adds the
 * fields that round-trip to Bitrix (description, dates, postановщик,
 * priority, assignee, status) plus a deep-link to view it in Bitrix.
 */
export function BitrixMirrorPanel({
  status,
  assignee,
  description,
  creator,
  priority,
  dueDate,
  startedAt,
  completedAt,
  externalId,
}: Props) {
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-900">
          Из Bitrix24 (read-only)
        </div>
        {externalId ? (
          <a
            href={`${BITRIX_BASE}/workgroups/group/0/tasks/task/view/${externalId}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900"
          >
            Открыть в Bitrix
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>

      <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
        <Term>Статус</Term>
        <Def>
          <TaskStatusBadge status={status} />
        </Def>

        <Term>Исполнитель</Term>
        <Def>{renderPerson(assignee)}</Def>

        <Term>Постановщик</Term>
        <Def>{renderPerson(creator)}</Def>

        {priority ? (
          <>
            <Term>Срочность</Term>
            <Def>
              <span className="inline-flex items-center gap-1.5 text-xs">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[priority]}`}
                />
                {PRIORITY_LABEL[priority]}
              </span>
            </Def>
          </>
        ) : null}

        <Term>Дедлайн</Term>
        <Def className="text-xs">{fmt(dueDate)}</Def>

        <Term>Старт по плану</Term>
        <Def className="text-xs">{fmt(startedAt)}</Def>

        {completedAt ? (
          <>
            <Term>Закрыта</Term>
            <Def className="text-xs">{fmt(completedAt)}</Def>
          </>
        ) : null}
      </dl>

      {description ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-medium text-blue-900 hover:underline">
            Описание из Bitrix24
          </summary>
          <div className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-blue-100 bg-white p-3 text-xs">
            {renderRichText(description)}
          </div>
        </details>
      ) : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Эти поля синхронизируются с Bitrix24 и редактируются там же.
        Внутренние статус и исполнители — ниже.
      </p>
    </div>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {children}
    </dt>
  );
}

function Def({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <dd className={`min-w-0 ${className}`}>{children}</dd>;
}

function renderPerson(p: Person | null): React.ReactNode {
  if (!p) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <Avatar src={p.image} alt={p.name} className="h-5 w-5" />
      {p.name}
    </span>
  );
}
