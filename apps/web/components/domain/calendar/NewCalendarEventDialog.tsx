'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { X, Calendar as CalendarIcon, Phone } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { createCalendarEventAction } from '@/actions/calendar';
import { createMeetingAction } from '@/actions/meetings';

type Mode = 'event' | 'call';

type Detail = {
  /** YYYY-MM-DD date the popover was opened on. */
  date: string;
  /** Pre-selected mode (event = personal entry, call = meeting). */
  mode: Mode;
};

/**
 * Quick-create dialog for calendar entries that aren't tasks:
 *   - mode='event' → CalendarEvent (personal/team item)
 *   - mode='call'  → Meeting with optional scheduled marker. Since
 *     Meeting has no `scheduledAt` column yet, we additionally drop a
 *     CalendarEvent linked to the day so it shows up on the grid.
 *
 * Listens for the `giper:new-calendar-entry` event so the day popover
 * can summon us with a pre-filled date + mode.
 */
export function NewCalendarEventDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('event');
  const [date, setDate] = useState<string>('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail as Detail | undefined;
      if (!detail?.date) return;
      setDate(detail.date);
      setMode(detail.mode);
      setOpen(true);
    };
    window.addEventListener('giper:new-calendar-entry', onOpen);
    return () => window.removeEventListener('giper:new-calendar-entry', onOpen);
  }, []);

  useEffect(() => {
    if (!open) {
      setTitle('');
      setLocation('');
      setDescription('');
      setError(null);
      setIsAllDay(false);
      setStartTime('09:00');
      setEndTime('10:00');
    } else {
      setTimeout(() => titleRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = useCallback(() => {
    const t = title.trim();
    if (t.length < 2) {
      setError('Название — минимум 2 символа');
      return;
    }
    if (!date) {
      setError('Не выбрана дата');
      return;
    }
    setError(null);
    startTransition(async () => {
      // Build ISO timestamps. All-day = midnight–midnight in local tz.
      let startAt: string;
      let endAt: string;
      if (isAllDay) {
        startAt = new Date(`${date}T00:00:00`).toISOString();
        const next = new Date(`${date}T00:00:00`);
        next.setDate(next.getDate() + 1);
        endAt = next.toISOString();
      } else {
        startAt = new Date(`${date}T${startTime}:00`).toISOString();
        endAt = new Date(`${date}T${endTime}:00`).toISOString();
        if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
          setError('Время окончания должно быть позже начала');
          return;
        }
      }

      if (mode === 'call') {
        // Spin up the Meeting first (it's PM/ADMIN-gated so we surface
        // the error early) then mirror it as a CalendarEvent so the
        // grid shows the planned slot. Title is reused verbatim.
        const m = await createMeetingAction({ title: t });
        if (!m.ok) {
          setError(m.message);
          return;
        }
        const ev = await createCalendarEventAction({
          title: `Созвон: ${t}`,
          description: description.trim() || undefined,
          startAt,
          endAt,
          isAllDay,
          location: `meeting:${m.meeting.id}`,
        });
        if (!ev.ok) {
          setError(ev.error.message);
          return;
        }
        router.refresh();
        setOpen(false);
        return;
      }

      const ev = await createCalendarEventAction({
        title: t,
        description: description.trim() || undefined,
        startAt,
        endAt,
        isAllDay,
        location: location.trim() || undefined,
      });
      if (!ev.ok) {
        setError(ev.error.message);
        return;
      }
      router.refresh();
      setOpen(false);
    });
  }, [title, date, isAllDay, startTime, endTime, mode, description, location, router]);

  if (typeof document === 'undefined' || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-3 pt-[8vh] md:p-4 md:pt-[15vh]"
      onClick={() => !pending && setOpen(false)}
    >
      <div
        data-no-shortcuts
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm font-medium">
            {mode === 'call' ? (
              <Phone className="h-4 w-4" />
            ) : (
              <CalendarIcon className="h-4 w-4" />
            )}
            {mode === 'call' ? 'Новый созвон' : 'Новое событие'}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Название
            </span>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={mode === 'call' ? 'Тема созвона' : 'Что планируем'}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              maxLength={200}
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Дата
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Начало
              </span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={pending || isAllDay}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Конец
              </span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={pending || isAllDay}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={(e) => setIsAllDay(e.target.checked)}
              disabled={pending}
            />
            Весь день
          </label>

          {mode === 'event' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Место (комната, ссылка, адрес)
              </span>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Не обязательно"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                maxLength={200}
              />
            </label>
          ) : null}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Описание
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Не обязательно"
              className="min-h-[60px] resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
          </label>

          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Отмена
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={submit}
            disabled={pending || title.trim().length < 2 || !date}
          >
            {pending ? 'Создаём…' : 'Создать'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
