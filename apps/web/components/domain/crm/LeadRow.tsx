'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Check, X, UserPlus, Ban, RotateCcw } from 'lucide-react';
import { Input } from '@giper/ui/components/Input';
import { Button } from '@giper/ui/components/Button';
import type { LeadRow as Lead } from '@/lib/crm';
import {
  updateLeadAction,
  deleteLeadAction,
  convertLeadAction,
} from '@/actions/crm';

const STATUS_LABEL: Record<Lead['status'], string> = {
  NEW: 'Новый',
  CONVERTED: 'Сконвертирован',
  DISQUALIFIED: 'Дисквалифицирован',
};

const STATUS_CLASS: Record<Lead['status'], string> = {
  NEW: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  CONVERTED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  DISQUALIFIED: 'bg-muted text-muted-foreground',
};

/**
 * One lead in the CRM leads list. NEW leads (for CRM editors) can be edited,
 * disqualified, deleted, or converted into a Contact (+ optional Deal).
 * CONVERTED leads are read-only and link to the resulting contact/deal.
 */
export function LeadRow({
  lead,
  canEdit,
  hasPipeline,
}: {
  lead: Lead;
  canEdit: boolean;
  /** Whether a sales pipeline exists — gates the "create deal" convert option. */
  hasPipeline: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // edit fields
  const [name, setName] = useState(lead.name);
  const [company, setCompany] = useState(lead.company ?? '');
  const [email, setEmail] = useState(lead.email ?? '');
  const [phone, setPhone] = useState(lead.phone ?? '');
  const [source, setSource] = useState(lead.source ?? '');

  // convert panel
  const [createDeal, setCreateDeal] = useState(hasPipeline);
  const [dealTitle, setDealTitle] = useState('');
  const [amount, setAmount] = useState('');

  function resetEdit() {
    setName(lead.name);
    setCompany(lead.company ?? '');
    setEmail(lead.email ?? '');
    setPhone(lead.phone ?? '');
    setSource(lead.source ?? '');
    setError(null);
    setEditing(false);
  }

  function save() {
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
      const res = await updateLeadAction(lead.id, { name, company, email, phone, source });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function setStatus(status: 'NEW' | 'DISQUALIFIED') {
    startTransition(async () => {
      const res = await updateLeadAction(lead.id, {
        name: lead.name,
        email: lead.email ?? undefined,
        phone: lead.phone ?? undefined,
        company: lead.company ?? undefined,
        source: lead.source ?? undefined,
        status,
      });
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Удалить лид «${lead.name}»?`)) return;
    startTransition(async () => {
      const res = await deleteLeadAction(lead.id);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
      router.refresh();
    });
  }

  function convert() {
    setError(null);
    startTransition(async () => {
      const res = await convertLeadAction(lead.id, {
        createDeal,
        dealTitle: dealTitle.trim() || undefined,
        amount: amount.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setConverting(false);
      router.refresh();
    });
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 py-2">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Компания" />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" />
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Источник" />
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            <Check className="h-3.5 w-3.5" /> Сохранить
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={resetEdit}>
            <X className="h-3.5 w-3.5" /> Отмена
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{lead.name}</span>
          {lead.company ? <span className="text-muted-foreground"> · {lead.company}</span> : null}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_CLASS[lead.status]}`}>
            {STATUS_LABEL[lead.status]}
          </span>
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {lead.email ? <span>{lead.email}</span> : null}
          {lead.phone ? <span>{lead.phone}</span> : null}
          {lead.source ? <span className="italic">{lead.source}</span> : null}
          {lead.status === 'CONVERTED' ? (
            <span className="flex items-center gap-2">
              <Link href="/crm/contacts" className="hover:underline">→ контакт</Link>
              {lead.convertedDealId ? (
                <Link href="/crm" className="hover:underline">→ сделка</Link>
              ) : null}
            </span>
          ) : null}
          {canEdit && lead.status === 'NEW' ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { setConverting((v) => !v); setError(null); }}
                disabled={pending}
                aria-label={`Конвертировать ${lead.name}`}
                className="rounded-md p-1 hover:bg-emerald-500/10 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(true)}
                disabled={pending}
                aria-label={`Редактировать ${lead.name}`}
                className="rounded-md p-1 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setStatus('DISQUALIFIED')}
                disabled={pending}
                aria-label={`Дисквалифицировать ${lead.name}`}
                className="rounded-md p-1 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                aria-label={`Удалить ${lead.name}`}
                className="rounded-md p-1 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
          {canEdit && lead.status === 'DISQUALIFIED' ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStatus('NEW')}
                disabled={pending}
                aria-label={`Вернуть в работу ${lead.name}`}
                className="rounded-md p-1 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                aria-label={`Удалить ${lead.name}`}
                className="rounded-md p-1 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : null}
        </span>
      </div>

      {converting && canEdit && lead.status === 'NEW' ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={createDeal}
              disabled={pending || !hasPipeline}
              onChange={(e) => setCreateDeal(e.target.checked)}
            />
            Создать сделку{!hasPipeline ? ' (нет воронки)' : ''}
          </label>
          {createDeal && hasPipeline ? (
            <div className="flex flex-wrap items-end gap-2">
              <Input
                value={dealTitle}
                onChange={(e) => setDealTitle(e.target.value)}
                placeholder={`Название сделки (по умолч. «${lead.name}»)`}
                className="min-w-[14rem] flex-1"
              />
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="Сумма"
                className="w-28 text-right tabular-nums"
              />
            </div>
          ) : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={convert}>
              <UserPlus className="h-3.5 w-3.5" /> Конвертировать
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => { setConverting(false); setError(null); }}
            >
              <X className="h-3.5 w-3.5" /> Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
