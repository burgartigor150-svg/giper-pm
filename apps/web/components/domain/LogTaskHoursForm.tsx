'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Trash2 } from 'lucide-react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Input } from '@giper/ui/components/Input';
import {
  deleteTimeEntryAction,
  logTaskHoursAction,
} from '@/actions/time';
import { formatMinutes } from '@/lib/format/duration';

type Entry = {
  id: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  durationMin: number | null;
  note: string | null;
  source: string;
  user: { id: string; name: string; image: string | null };
};

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  /** The current viewer's id, for "delete my own entry" affordance. */
  currentUserId: string;
  /** Pre-loaded recent entries for this task (server-rendered). */
  entries: Entry[];
};

/**
 * Compact "log hours" form on the task detail page. Three fields:
 *   - hours (number, 0.25 step) — the only required input.
 *   - date — defaults to today, override for retroactive entries.
 *   - note — free text, optional.
 *
 * The recent-entries list under the form lets the user see their own
 * and the team's recent contributions and delete their own with one
 * click. Other people's entries are read-only.
 */
export function LogTaskHoursForm({
  taskId,
  projectKey,
  taskNumber,
  currentUserId,
  entries,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState('');
  const [date, setDate] = useState<string>(() => isoDate(new Date()));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const n = Number(hours.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setError('Введите часы');
      return;
    }
    startTransition(async () => {
      const res = await logTaskHoursAction(
        taskId,
        projectKey,
        taskNumber,
        n,
        date,
        note.trim() || undefined,
      );
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setHours('');
      setNote('');
      router.refresh();
    });
  }

  function remove(entryId: string) {
    startTransition(async () => {
      await deleteTimeEntryAction(entryId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-input bg-background p-2">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Часов
            </span>
            <Input
              type="number"
              min="0"
              step="0.25"
              placeholder="1.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={pending}
              className="h-8 w-20 text-sm tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Дата
            </span>
            <Input
              type="date"
              value={date}
              max={isoDate(new Date())}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="h-8 text-sm"
            />
          </label>
        </div>
        <Input
          placeholder="Заметка (необязательно)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          disabled={pending}
          className="h-8 text-sm"
        />
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={submit}
            disabled={pending || !hours.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1 text-xs text-background hover:opacity-90 disabled:opacity-50"
          >
            <Clock className="h-3 w-3" />
            Списать
          </button>
        </div>
      </div>

      {entries.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => {
            const minutes =
              e.endedAt && e.durationMin != null
                ? e.durationMin
                : Math.max(
                    0,
                    Math.floor(
                      (Date.now() - new Date(e.startedAt).getTime()) / 60_000,
                    ),
                  );
            const isMine = e.user.id === currentUserId;
            const isLive = !e.endedAt;
            return (
              <li
                key={e.id}
                className="group flex items-center gap-2 text-xs"
                title={e.note ?? undefined}
              >
                <Avatar src={e.user.image} alt={e.user.name} className="h-4 w-4" />
                <span className="truncate text-muted-foreground">
                  {e.user.name}
                </span>
                <span className="font-mono tabular-nums">
                  {isLive ? (
                    <span className="text-emerald-600">идёт…</span>
                  ) : (
                    formatMinutes(minutes)
                  )}
                </span>
                <span className="text-muted-foreground">
                  {new Date(e.startedAt).toLocaleDateString('ru-RU')}
                </span>
                {e.note ? (
                  <span className="truncate text-muted-foreground">
                    · {e.note}
                  </span>
                ) : null}
                {isMine && !isLive ? (
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    disabled={pending}
                    aria-label="Удалить запись"
                    className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
