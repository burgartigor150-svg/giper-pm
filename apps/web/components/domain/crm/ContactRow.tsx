'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import { Input } from '@giper/ui/components/Input';
import { Button } from '@giper/ui/components/Button';
import { updateContactAction, deleteContactAction } from '@/actions/crm';

type Contact = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  dealCount: number;
};

/**
 * One contact in the CRM contacts list. Read-only for non-editors; CRM
 * editors (ADMIN/PM) get inline edit + soft-delete — previously contacts
 * had no edit/delete path at all (a typo was permanent).
 */
export function ContactRow({ contact, canEdit }: { contact: Contact; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(contact.name);
  const [company, setCompany] = useState(contact.company ?? '');
  const [email, setEmail] = useState(contact.email ?? '');
  const [phone, setPhone] = useState(contact.phone ?? '');
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Имя ≥ 2 символов');
      return;
    }
    startTransition(async () => {
      const res = await updateContactAction(contact.id, { name, company, email, phone });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Удалить контакт «${contact.name}»?`)) return;
    startTransition(async () => {
      const res = await deleteContactAction(contact.id);
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error.message);
        return;
      }
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
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={save}>
            <Check className="h-3.5 w-3.5" /> Сохранить
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setError(null);
              setName(contact.name);
              setCompany(contact.company ?? '');
              setEmail(contact.email ?? '');
              setPhone(contact.phone ?? '');
            }}
          >
            <X className="h-3.5 w-3.5" /> Отмена
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li id={`contact-${contact.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm scroll-mt-20">
      <span className="min-w-0">
        <span className="font-medium">{contact.name}</span>
        {contact.company ? <span className="text-muted-foreground"> · {contact.company}</span> : null}
      </span>
      <span className="flex items-center gap-3 text-xs text-muted-foreground">
        {contact.email ? <span>{contact.email}</span> : null}
        {contact.phone ? <span>{contact.phone}</span> : null}
        <span className="tabular-nums">{contact.dealCount} сд.</span>
        {canEdit ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              aria-label={`Редактировать ${contact.name}`}
              className="rounded-md p-1 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              aria-label={`Удалить ${contact.name}`}
              className="rounded-md p-1 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </span>
    </li>
  );
}
