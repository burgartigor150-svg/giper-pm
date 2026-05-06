import { notFound } from 'next/navigation';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { listTeamStatus } from '@/lib/team/listTeamStatus';
import { getT } from '@/lib/i18n';
import { TeamTable } from '@/components/domain/team/TeamTable';

export default async function TeamPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') notFound();

  const t = await getT('team');
  const rows = await listTeamStatus();

  // Serialize Date instances → ISO strings for the client component.
  const serialized = rows.map((r) => ({
    user: r.user,
    currentTask: r.currentTask,
    timerStartedAt: r.timerStartedAt ? r.timerStartedAt.toISOString() : null,
    todayMin: r.todayMin,
    status: r.status,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <Card className="overflow-hidden">
        <TeamTable rows={serialized} />
      </Card>
    </div>
  );
}
