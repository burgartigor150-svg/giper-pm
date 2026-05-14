'use client';

import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { createMeetingInviteAction } from '@/actions/meetings';

/**
 * "Пригласить гостя" — issues a shareable URL the caller can drop
 * into email / Telegram. The URL points at /m/<token> outside the
 * authenticated app group; whoever opens it picks a display name and
 * joins the LiveKit room as a guest participant (userId=null).
 *
 * Rendered above the room mount on /meetings/[id]. Only the meeting
 * creator (or ADMIN) sees it — enforced server-side too.
 */
export function InviteGuestButton({ meetingId }: { meetingId: string }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function issue() {
    setErr(null);
    setCopied(false);
    startTransition(async () => {
      const r = await createMeetingInviteAction({
        meetingId,
        expiresInHours: 24,
      });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      setUrl(r.url);
      setExpiresAt(r.expiresAt);
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Browsers without clipboard permission: fall back to text-select.
      window.prompt('Скопируйте ссылку вручную:', url);
    }
  }

  if (!url) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={issue} disabled={pending}>
          {pending ? 'Создаю…' : 'Пригласить гостя по ссылке'}
        </Button>
        {err ? <span className="text-xs text-destructive">{err}</span> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-sm">
      <span className="text-xs text-muted-foreground">Гостевая ссылка (действует 24 ч):</span>
      <code className="max-w-md truncate rounded bg-background px-2 py-1 font-mono text-xs">
        {url}
      </code>
      <Button type="button" size="sm" onClick={copy}>
        {copied ? 'Скопировано' : 'Копировать'}
      </Button>
      <span className="text-xs text-muted-foreground">
        до {new Date(expiresAt!).toLocaleString('ru-RU')}
      </span>
    </div>
  );
}
