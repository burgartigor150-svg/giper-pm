import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canSeeServiceDesk, canWorkTickets } from '@/lib/permissions';
import { listTickets } from '@/lib/servicedesk';
import { TicketQueueTable } from '@/components/domain/servicedesk/TicketQueueTable';

export const dynamic = 'force-dynamic';

export default async function ServiceDeskPage() {
  const me = await requireAuth();
  if (!canSeeServiceDesk({ id: me.id, role: me.role })) notFound();
  const canEdit = canWorkTickets({ id: me.id, role: me.role });
  const tickets = await listTickets();

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
        <TicketQueueTable tickets={tickets} canEdit={canEdit} />
      </Card>
    </div>
  );
}
