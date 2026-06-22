import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { getTable } from '@/lib/knowledge/getTables';
import { KbTableHeader } from '@/components/domain/knowledge/KbTableHeader';
import { KbTableGrid } from '@/components/domain/knowledge/KbTableGrid';

export default async function KnowledgeTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireAuth();
  const table = await getTable(id);
  if (!table) notFound();

  const canEdit = me.role !== 'VIEWER';

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

      <KbTableGrid tableId={table.id} columns={table.columns} rows={table.rows} canEdit={canEdit} />
    </div>
  );
}
