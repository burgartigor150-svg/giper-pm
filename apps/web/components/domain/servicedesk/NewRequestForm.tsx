'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { createTicketAction } from '@/actions/servicedesk';

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};

export function NewRequestForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (subject.trim().length < 2 || requesterName.trim().length < 2) {
      setError('Заполните тему и имя заявителя');
      return;
    }
    startTransition(async () => {
      const res = await createTicketAction({
        subject: subject.trim(),
        requesterName: requesterName.trim(),
        requesterEmail: requesterEmail.trim() || undefined,
        description: description.trim() || undefined,
        priority,
      });
      if (res.ok) router.push('/servicedesk');
      else setError(res.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={pending} maxLength={300}
        placeholder="Тема обращения" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" />
      <div className="flex flex-wrap gap-2">
        <input value={requesterName} onChange={(e) => setRequesterName(e.target.value)} disabled={pending} maxLength={200}
          placeholder="Имя заявителя" className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
        <input type="email" value={requesterEmail} onChange={(e) => setRequesterEmail(e.target.value)} disabled={pending} maxLength={200}
          placeholder="E-mail заявителя" className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
        <select value={priority} onChange={(e) => setPriority(e.target.value)} disabled={pending} aria-label="Приоритет"
          className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} rows={5}
        placeholder="Описание (необязательно)" className="w-full rounded-md border border-input bg-background p-2 text-sm" />
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" onClick={submit} disabled={pending || subject.trim() === ''}>
          {pending ? 'Создаю…' : 'Создать обращение'}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
