import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { getTable, getRelatedRowLabels, listSpaceTables } from '@/lib/knowledge/getTables';
import { getSpaceAccessById } from '@/lib/knowledge/access';
import { KbTableHeader } from '@/components/domain/knowledge/KbTableHeader';
import { KbTableViews } from '@/components/domain/knowledge/KbTableViews';

export default async function KnowledgeTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireAuth();
  const table = await getTable(id);
  if (!table) notFound();

  const access = await getSpaceAccessById(me, table.spaceId);
  if (!access.canView) notFound();

  const canEdit = access.canEdit;

  // RELATION columns reference other tables in this space — load their rows as
  // {id,label} pickers, plus the space's tables for the add-RELATION-column UI.
  const relationTableIds = table.columns
    .filter((c) => c.type === 'RELATION' && c.relationTableId)
    .map((c) => c.relationTableId as string);
  const [relations, spaceTables] = await Promise.all([
    getRelatedRowLabels(relationTableIds),
    listSpaceTables(table.spaceId),
  ]);
  const tableRefs = spaceTables.map((t) => ({ id: t.id, name: t.name }));

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Link href="/knowledge" className="hover:text-foreground">
          База знаний
        </Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/knowledge/space/${table.spaceId}`} className="hover:text-foreground">
          {table.space.icon ?? '📚'} {table.space.name}
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">{table.name}</span>
      </nav>

      <KbTableHeader
        tableId={table.id}
        spaceId={table.spaceId}
        name={table.name}
        icon={table.icon}
        canEdit={canEdit}
      />

      <KbTableViews
        tableId={table.id}
        columns={table.columns}
        rows={table.rows}
        canEdit={canEdit}
        relations={relations}
        spaceTables={tableRefs}
      />
    </div>
  );
}
