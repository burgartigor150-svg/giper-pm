'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { createLeadAction } from '@/actions/crm';

/** Inline form to capture a top-of-funnel lead. Requires name + email OR phone. */
export function NewLeadForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Имя ≥ 2 символов');
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setError('Укажите email или телефон');
      return;
    }
    startTransition(async () => {
      const res = await createLeadAction({
        name: name.trim(),
        company: company.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        source: source.trim() || undefined,
      });
      if (res.ok) {
        setName('');
        setCompany('');
        setEmail('');
        setPhone('');
        setSource('');
        router.refresh();
      } else {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} maxLength={200}
        placeholder="Имя" className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
      <input value={company} onChange={(e) => setCompany(e.target.value)} disabled={pending} maxLength={200}
        placeholder="Компания" className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} maxLength={200}
        placeholder="E-mail" className="h-9 min-w-[8rem] flex-1 rounded-md border border-input bg-background px-2 text-sm" />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={pending} maxLength={60}
        placeholder="Телефон" className="h-9 w-36 rounded-md border border-input bg-background px-2 text-sm" />
      <input value={source} onChange={(e) => setSource(e.target.value)} disabled={pending} maxLength={120}
        placeholder="Источник" className="h-9 w-32 rounded-md border border-input bg-background px-2 text-sm" />
      <Button type="button" size="sm" onClick={submit} disabled={pending || name.trim() === ''}>
        <Plus className="mr-1 h-4 w-4" />
        {pending ? 'Создаю…' : 'Лид'}
      </Button>
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
