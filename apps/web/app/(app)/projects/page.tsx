import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canCreateProject } from '@/lib/permissions';
import { listProjectsForUser, type ListFilter } from '@/lib/projects';
import { getT } from '@/lib/i18n';
import { ProjectFilters } from '@/components/domain/ProjectFilters';
import { StatusBadge } from '@/components/domain/StatusBadge';
import { Avatar } from '@giper/ui/components/Avatar';

const STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string; archived?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireAuth();
  const t = await getT('projects');

  const filter: ListFilter = {
    scope: sp.scope === 'all' ? 'all' : 'mine',
    status:
      sp.status && (STATUSES as readonly string[]).includes(sp.status)
        ? (sp.status as ListFilter['status'])
        : undefined,
    includeArchived: sp.archived === '1',
  };

  const projects = await listProjectsForUser({ id: user.id, role: user.role }, filter);
  const canCreate = canCreateProject({ id: user.id, role: user.role });

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        {canCreate ? (
          <Link href="/projects/new">
            <Button>{t('create')}</Button>
          </Link>
        ) : null}
      </div>

      <Card className="p-4">
        <ProjectFilters
          scope={filter.scope ?? 'mine'}
          status={filter.status}
          includeArchived={filter.includeArchived ?? false}
          showAllScope={user.role === 'ADMIN' || user.role === 'PM'}
        />
      </Card>

      <Card className="overflow-hidden">
        {projects.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">{t('empty')}</div>
        ) : (
          <div className="-mx-px overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{t('table.key')}</th>
                <th className="px-4 py-2 font-medium">{t('table.name')}</th>
                <th className="px-4 py-2 font-medium">{t('table.status')}</th>
                <th className="px-4 py-2 font-medium">{t('table.owner')}</th>
                <th className="px-4 py-2 font-medium">{t('table.members')}</th>
                <th className="px-4 py-2 font-medium">{t('table.tasks')}</th>
                <th className="px-4 py-2 font-medium">{t('table.deadline')}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-border transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/projects/${p.key}`} className="hover:underline">
                      {p.key}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`/projects/${p.key}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      <Avatar
                        src={p.owner.image}
                        alt={p.owner.name}
                        className="h-6 w-6"
                      />
                      <span className="text-muted-foreground">{p.owner.name}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{p._count.members}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p._count.tasks}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {p.deadline ? new Date(p.deadline).toLocaleDateString('ru-RU') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}
