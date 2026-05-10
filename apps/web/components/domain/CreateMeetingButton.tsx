'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { createMeetingAction } from '@/actions/meetings';

export function CreateMeetingButton({
  projectKey,
  label = 'Новая встреча',
  defaultTitle = '',
}: {
  projectKey?: string;
  label?: string;
  defaultTitle?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setErr(null);
    startTransition(async () => {
      const r = await createMeetingAction({ projectKey, title: title.trim() });
      if (!r.ok) {
        setErr(r.message);
        return;
      }
      router.push(`/meetings/${r.meeting.id}`);
    });
  }

  if (!open) {
    return (
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        + {label}
      </Button>
    );
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Тема встречи"
        className="w-64"
        required
      />
      <Button type="submit" size="sm" disabled={pending || !title.trim()}>
        {pending ? 'Создаю…' : 'Создать и войти'}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
        Отмена
      </Button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </form>
  );
}
