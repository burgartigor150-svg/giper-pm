import { redirect } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import {
  listAllTemplates,
  listKnowledgeSpaces,
} from '@/lib/knowledge/getKnowledge';
import { KbTemplatesManager } from '@/components/domain/knowledge/KbTemplatesManager';

export default async function KnowledgeTemplatesPage() {
  const me = await requireAuth();
  const canManage = me.role === 'ADMIN' || me.role === 'PM';
  if (!canManage) redirect('/knowledge');

  const [templates, spaces] = await Promise.all([listAllTemplates(), listKnowledgeSpaces(me)]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">Шаблоны</h1>
        <p className="text-sm text-muted-foreground">
          Шаблоны статей для быстрого создания однотипного контента. Общие доступны во всех
          пространствах, шаблоны пространств — только в своём.
        </p>
      </header>
      <KbTemplatesManager
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          icon: t.icon,
          scope: t.scope,
          spaceId: t.spaceId,
          content: t.content,
          space: t.space,
        }))}
        spaces={spaces.map((s) => ({ id: s.id, name: s.name, icon: s.icon }))}
      />
    </div>
  );
}
