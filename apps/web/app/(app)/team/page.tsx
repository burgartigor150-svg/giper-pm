import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { listTeamStatus } from '@/lib/team/listTeamStatus';
import { getT } from '@/lib/i18n';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { TeamTable } from '@/components/domain/team/TeamTable';
import { PmTeamRoster } from '@/components/domain/team/PmTeamRoster';
import { SyncTeamFromBitrixButton } from '@/components/domain/team/SyncTeamFromBitrixButton';
import { listTeamMembers } from '@/actions/pmTeam';

export default async function TeamPage() {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') notFound();

  const t = await getT('team');
  const [rows, members, pms] = await Promise.all([
    listTeamStatus(),
    listTeamMembers(),
    prisma.user.findMany({
      where: { role: 'PM', isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  // Serialize Date instances → ISO strings for the client component.
  const serialized = rows.map((r) => ({
    user: r.user,
    currentTask: r.currentTask,
    timerStartedAt: r.timerStartedAt ? r.timerStartedAt.toISOString() : null,
    todayMin: r.todayMin,
    status: r.status,
  }));

  const pmsById: Record<string, string> = {};
  for (const p of pms) pmsById[p.id] = p.name;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Link
          href="/team/tasks"
          className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100"
        >
          Задачи моей команды
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Card className="overflow-hidden">
        <TeamTable rows={serialized} />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Моя команда и доступные ресурсы</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SyncTeamFromBitrixButton />
          <PmTeamRoster members={members} pmsById={pmsById} />
        </CardContent>
      </Card>
    </div>
  );
}
