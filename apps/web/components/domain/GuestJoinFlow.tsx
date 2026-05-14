'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { joinMeetingAsGuestAction } from '@/actions/meetings';
import { GuestMeetingRoom } from './GuestMeetingRoom';

type Joined = {
  serverUrl: string;
  token: string;
  identity: string;
  displayName: string;
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  meeting: { id: string; title: string; status: string };
};

/**
 * Two-step guest flow:
 *
 *   1. Name form — minimal, just "введите имя". No email, no phone,
 *      nothing that turns this into a tracking funnel. The display
 *      name lands on the LiveKit tile and the MeetingParticipant row.
 *
 *   2. After successful join action → mount GuestMeetingRoom with
 *      the freshly minted LiveKit JWT.
 *
 * Error states stay on the name form so the guest can retry without
 * losing what they typed.
 */
export function GuestJoinFlow({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setErr('Введите имя (минимум 2 символа)');
      return;
    }
    setErr(null);
    startTransition(async () => {
      const r = await joinMeetingAsGuestAction({ token, displayName: name.trim() });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setJoined({
        serverUrl: r.serverUrl,
        token: r.token,
        identity: r.identity,
        displayName: r.displayName,
        iceServers: r.iceServers,
        meeting: r.meeting,
      });
    });
  }

  if (joined) {
    return (
      <GuestMeetingRoom
        serverUrl={joined.serverUrl}
        token={joined.token}
        title={joined.meeting.title}
        defaultName={joined.displayName}
        iceServers={joined.iceServers}
      />
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div>
          <h1 className="text-lg font-semibold">Присоединиться к звонку</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Это гостевой вход. После того как введёте имя, откроется видео-комната.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="guest-name" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Ваше имя
          </label>
          <Input
            id="guest-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Иван Петров"
            required
            maxLength={80}
          />
        </div>
        {err ? <p className="text-sm text-destructive">{err}</p> : null}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Подключаюсь…' : 'Войти'}
        </Button>
        <p className="text-xs text-muted-foreground">
          giper-pm не сохраняет ваш аккаунт. После окончания встречи доступ к этой
          ссылке закроется.
        </p>
      </form>
    </div>
  );
}
