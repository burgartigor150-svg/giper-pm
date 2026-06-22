import { requireAuth } from '@/lib/auth';
import {
  listKnowledgeSpaces,
  getAllArticlesForSidebar,
} from '@/lib/knowledge/getKnowledge';
import { KbSidebar } from '@/components/domain/knowledge/KbSidebar';

/**
 * Knowledge Base shell: persistent space/article tree on the left, the active
 * article (or KB home) on the right. The sidebar stays mounted across article
 * navigation; it derives the active article from the URL.
 */
export default async function KnowledgeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireAuth();
  const [spaces, articles] = await Promise.all([
    listKnowledgeSpaces(),
    getAllArticlesForSidebar(),
  ]);

  const canManageSpaces = me.role === 'ADMIN' || me.role === 'PM';
  const canEdit = me.role !== 'VIEWER';

  return (
    <div className="flex min-h-[calc(100vh-7rem)] overflow-hidden rounded-lg border border-neutral-200 bg-background dark:border-neutral-800">
      <aside className="w-64 shrink-0 border-r border-neutral-200 dark:border-neutral-800">
        <KbSidebar
          spaces={spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon }))}
          articles={articles}
          canManageSpaces={canManageSpaces}
          canEdit={canEdit}
        />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto p-6 md:p-8">{children}</div>
    </div>
  );
}
