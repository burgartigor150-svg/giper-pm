import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import { Card } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canCreateProject, canSeeSettings } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { listProjectsForUser, type ListFilter } from '@/lib/projects';
import { getSpaces } from '@/lib/spaces/getSpaces';
import { getT } from '@/lib/i18n';
import { ProjectFilters } from '@/components/domain/ProjectFilters';
import { StatusBadge } from '@/components/domain/StatusBadge';
import {
  ProjectsSpaceBoard,
  type SpaceBoardGroup,
  type SpaceBoardProject,
} from '@/components/domain/ProjectsSpaceBoard';
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

  const caps = await getEffectiveCaps({ id: user.id, role: user.role });
  const projects = await listProjectsForUser({ id: user.id, role: user.role }, filter);
  const canCreate = canCreateProject({ id: user.id, role: user.role }, caps);
  const canManageSpaces = canSeeSettings({ id: user.id, role: user.role }, caps);

  // Group the ALREADY-visibility-filtered projects by space (purely a display
  // grouping — never a separate query, so it can't widen what the user sees).
  type Proj = (typeof projects)[number];
  const bySpace = new Map<string, Proj[]>();
  const ungrouped: Proj[] = [];
  for (const p of projects) {
    if (p.space) {
      const arr = bySpace.get(p.space.id);
      if (arr) arr.push(p);
      else bySpace.set(p.space.id, [p]);
    } else ungrouped.push(p);
  }
  const spaceGroups = [...bySpace.values()]
    .map((items) => ({ name: items[0]!.space!.name, order: items[0]!.space!.order, items }))
    .sort((a, b) => a.order - b.order);
  const hasGroups = spaceGroups.length > 0;

  // Managers (ADMIN/PM) get a drag board: every space is a drop target (even
  // empty ones), plus a "Без пространства" bucket. Non-managers keep the plain
  // read-only grouped tables.
  const allSpaces = canManageSpaces ? await getSpaces() : [];
  const toRow = (p: Proj): SpaceBoardProject => ({
    id: p.id,
    key: p.key,
    name: p.name,
    status: p.status,
    statusLabel: t(`status.${p.status}`),
    owner: { name: p.owner.name, image: p.owner.image },
    members: p._count.members,
    tasks: p._count.tasks,
    deadline: p.deadline ? new Date(p.deadline).toISOString() : null,
  });
  const dragGroups: SpaceBoardGroup[] = [
    ...allSpaces.map((s) => ({
      spaceId: s.id,
      name: s.name,
      projects: (bySpace.get(s.id) ?? []).map(toRow),
    })),
    { spaceId: null, name: 'Без пространства', projects: ungrouped.map(toRow) },
  ];
  const dragLabels = {
    key: t('table.key'),
    name: t('table.name'),
    status: t('table.status'),
    owner: t('table.owner'),
    members: t('table.members'),
    tasks: t('table.tasks'),
    deadline: t('table.deadline'),
  };
  const useDragBoard = canManageSpaces && allSpaces.length > 0 && projects.length > 0;

  function projectsTable(list: Proj[]) {
    return (
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
            {list.map((p) => (
              <tr key={p.id} className="border-t border-border transition-colors hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/projects/${p.key}`} className="hover:underline">{p.key}</Link>
                </td>
                <td className="px-4 py-2">
                  <Link href={`/projects/${p.key}`} className="hover:underline">{p.name}</Link>
                </td>
                <td className="px-4 py-2"><StatusBadge status={p.status} /></td>
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <Avatar src={p.owner.image} alt={p.owner.name} className="h-6 w-6" />
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
    );
  }

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

      {projects.length === 0 ? (
        <Card className="overflow-hidden">
          <div className="p-6 text-sm text-muted-foreground">{t('empty')}</div>
        </Card>
      ) : useDragBoard ? (
        <ProjectsSpaceBoard groups={dragGroups} labels={dragLabels} />
      ) : !hasGroups ? (
        <Card className="overflow-hidden">{projectsTable(projects)}</Card>
      ) : (
        <div className="space-y-4">
          {spaceGroups.map((g) => (
            <div key={g.name} className="space-y-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">{g.name}</h2>
              <Card className="overflow-hidden">{projectsTable(g.items)}</Card>
            </div>
          ))}
          {ungrouped.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="text-sm font-medium text-muted-foreground">Без пространства</h2>
              <Card className="overflow-hidden">{projectsTable(ungrouped)}</Card>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
