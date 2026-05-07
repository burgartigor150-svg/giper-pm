import { notFound } from 'next/navigation';
import { Card, CardContent } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { listPmTeamTasks } from '@/lib/teams/listPmTeamTasks';
import { listTeamMembers } from '@/actions/pmTeam';
import { PmTeamTasksTable } from '@/components/domain/team/PmTeamTasksTable';

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * Cross-project feed of every task touched by someone in the PM's
 * roster. The PM might have zero project-membership on the parent
 * project — they get visibility here through their team relationship.
 *
 * Empty state covers two scenarios:
 *   - the PM hasn't curated their team yet → CTA to /team page
 *   - team is set but nobody has open work right now → message
 */
export default async function PmTeamTasksPage({ searchParams }: { searchParams: SP }) {
  const me = await requireAuth();
  if (me.role !== 'ADMIN' && me.role !== 'PM') notFound();

  const sp = await searchParams;
  const memberId = typeof sp.memberId === 'string' ? sp.memberId : undefined;
  const source =
    sp.source === 'bitrix' || sp.source === 'local' ? sp.source : undefined;
  const onlyOpenRaw = typeof sp.onlyOpen === 'string' ? sp.onlyOpen : '1';
  const onlyOpen = onlyOpenRaw !== '0';

  const [tasks, members] = await Promise.all([
    listPmTeamTasks(me.id, { memberId, source, onlyOpen }),
    listTeamMembers(),
  ]);

  const myTeam = members.filter((m) => m.inMyTeam);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Задачи моей команды</h1>
        <p className="text-xs text-muted-foreground">
          Всё, над чем сейчас работают люди из вашей команды — независимо от того,
          состоите ли вы в проекте.
        </p>
      </div>

      {myTeam.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            В команде ещё никого нет.{' '}
            <a className="text-blue-700 hover:underline" href="/team">
              Откройте «Команда»
            </a>{' '}
            и добавьте людей, чьи задачи вы хотите видеть здесь.
          </CardContent>
        </Card>
      ) : (
        <PmTeamTasksTable
          tasks={tasks}
          team={myTeam.map((m) => ({ id: m.id, name: m.name }))}
          activeFilter={{ memberId, source, onlyOpen }}
        />
      )}
    </div>
  );
}
