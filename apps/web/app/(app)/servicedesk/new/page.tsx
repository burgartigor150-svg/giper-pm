import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canWorkTickets } from '@/lib/permissions';
import { NewRequestForm } from '@/components/domain/servicedesk/NewRequestForm';

export default async function NewTicketPage() {
  const me = await requireAuth();
  if (!canWorkTickets({ id: me.id, role: me.role })) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/servicedesk" className="text-sm text-muted-foreground hover:underline">← Сервис-деск</Link>
        <h1 className="text-xl font-semibold">Новое обращение</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Заявка</CardTitle>
        </CardHeader>
        <CardContent>
          <NewRequestForm />
        </CardContent>
      </Card>
    </div>
  );
}
