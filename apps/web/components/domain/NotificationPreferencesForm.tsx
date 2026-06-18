'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { NotificationKind } from '@giper/db';
import { Button } from '@giper/ui/components/Button';
import { NOTIFICATION_KIND_LABELS, NOTIFICATION_KINDS } from '@/lib/notifications/kinds';
import { setNotificationPreferencesAction } from '@/actions/notificationPrefs';

type Props = {
  /** kind → in-app delivery flag; missing = default (on). */
  initial: Partial<Record<NotificationKind, boolean>>;
};

/**
 * Per-kind in-app notification toggles. A toggle off mutes that category in
 * the inbox / bell. Saving upserts the full set for the current user.
 */
export function NotificationPreferencesForm({ initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<NotificationKind, boolean>>(() => {
    const base = {} as Record<NotificationKind, boolean>;
    for (const k of NOTIFICATION_KINDS) base[k] = initial[k] ?? true;
    return base;
  });

  function toggle(kind: NotificationKind) {
    setState((cur) => ({ ...cur, [kind]: !cur[kind] }));
  }

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const prefs = NOTIFICATION_KINDS.map((kind) => ({ kind, inApp: state[kind] }));
      const res = await setNotificationPreferencesAction(prefs);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Какие уведомления показывать в колокольчике и списке. Выключенные
        категории не будут вас беспокоить.
      </p>
      <ul className="flex flex-col divide-y">
        {NOTIFICATION_KINDS.map((kind) => (
          <li key={kind} className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm">{NOTIFICATION_KIND_LABELS[kind]}</span>
            <button
              type="button"
              role="switch"
              aria-checked={state[kind]}
              aria-label={NOTIFICATION_KIND_LABELS[kind]}
              onClick={() => toggle(kind)}
              disabled={pending}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                state[kind] ? 'bg-emerald-500' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  state[kind] ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
