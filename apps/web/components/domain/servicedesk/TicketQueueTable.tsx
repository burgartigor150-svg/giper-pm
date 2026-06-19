'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setTicketStatusAction } from '@/actions/servicedesk';
import { ticketSlaState } from '@/lib/servicedesk/sla';
import type { TicketRow } from '@/lib/servicedesk';
import { SlaBadge } from './SlaBadge';

const STATUS_LABELS: Record<TicketRow['status'], string> = {
  OPEN: 'Открыт',
  IN_PROGRESS: 'В работе',
  WAITING: 'Ждём заявителя',
  RESOLVED: 'Решён',
  CLOSED: 'Закрыт',
};
const PRIORITY_LABELS: Record<TicketRow['priority'], string> = {
  LOW: 'Низкий',
  MEDIUM: 'Средний',
  HIGH: 'Высокий',
  URGENT: 'Срочный',
};
const SEVERITY: Record<string, number> = { breached: 4, 'due-soon': 3, 'on-track': 2, met: 1, none: 0 };

export function TicketQueueTable({ tickets, canEdit }: { tickets: TicketRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const now = Date.now();

  const rows = tickets
    .map((t) => ({ t, state: ticketSlaState(t, now) }))
    .sort((a, b) => SEVERITY[b.state]! - SEVERITY[a.state]! || b.t.createdAt.getTime() - a.t.createdAt.getTime());

  function setStatus(id: string, status: string) {
    startTransition(async () => {
      const res = await setTicketStatusAction(id, status);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  if (tickets.length === 0) {
    return <p className="p-6 text-sm text-muted-foreground">Обращений пока нет.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">SLA</th>
            <th className="px-3 py-2 font-medium">Тема</th>
            <th className="px-3 py-2 font-medium">Заявитель</th>
            <th className="px-3 py-2 font-medium">Приоритет</th>
            <th className="px-3 py-2 font-medium">Статус</th>
            <th className="px-3 py-2 font-medium">Исполнитель</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ t, state }) => (
            <tr key={t.id} className="border-t border-border hover:bg-muted/30">
              <td className="px-3 py-2"><SlaBadge state={state} /></td>
              <td className="px-3 py-2">
                <div className="max-w-[22rem] truncate font-medium" title={t.subject}>{t.subject}</div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <div className="truncate">{t.requesterName}</div>
                {t.requesterEmail ? <div className="truncate text-xs">{t.requesterEmail}</div> : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{PRIORITY_LABELS[t.priority]}</td>
              <td className="px-3 py-2">
                {canEdit ? (
                  <select
                    value={t.status}
                    disabled={pending}
                    onChange={(e) => setStatus(t.id, e.target.value)}
                    aria-label="Статус"
                    className="h-8 rounded border border-input bg-background px-1 text-xs"
                  >
                    {(Object.keys(STATUS_LABELS) as TicketRow['status'][]).map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-muted-foreground">{STATUS_LABELS[t.status]}</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{t.assigneeName ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
