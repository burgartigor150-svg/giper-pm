import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeServiceDesk, canWorkTickets } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { listTickets } from '@/lib/servicedesk';
import { listUsers } from '@/lib/users/listUsers';
import { TicketQueueTable } from '@/components/domain/servicedesk/TicketQueueTable';

export const dynamic = 'force-dynamic';

export default async function ServiceDeskPage() {
  const me = await requireAuth();
  const caps = await getEffectiveCaps({ id: me.id, role: me.role });
  if (!canSeeServiceDesk({ id: me.id, role: me.role }, caps)) notFound();
  const canEdit = canWorkTickets({ id: me.id, role: me.role }, caps);
  const tickets = await listTickets();
  // Agents eligible for assignment = active non-VIEWER users (same gate
  // the action enforces via canWorkTickets). Only needed when the viewer
  // can edit; viewers see read-only names.
  const assignableUsers = canEdit
    ? (await listUsers())
        .filter((u) => u.role !== 'VIEWER')
        .map((u) => ({ id: u.id, name: u.name }))
    : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Сервис-деск</h1>
        {canEdit ? (
          <Link href="/servicedesk/new">
            <Button size="sm">Новое обращение</Button>
          </Link>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <TicketQueueTable
          tickets={tickets}
          canEdit={canEdit}
          assignableUsers={assignableUsers}
        />
      </Card>
    </div>
  );
}
