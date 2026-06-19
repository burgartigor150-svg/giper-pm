import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@giper/ui/components/Card';
import { Button } from '@giper/ui/components/Button';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { getDocuments, type DocumentListItem } from '@/lib/documents/getDocuments';
import { createDocumentAction } from '@/actions/documents';

export default async function ProjectDocsPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();

  const project = await getProject(projectKey, {
    id: user.id,
    role: user.role,
  }).catch((e) => {
    if (
      e instanceof DomainError &&
      (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')
    ) {
      notFound();
    }
    throw e;
  });

  // Document create/edit/delete is gated by canEditProject in the action;
  // only show the create control to users who can actually use it (otherwise
  // the button silently no-ops for plain viewers).
  const canEdit = canEditProject({ id: user.id, role: user.role }, project);

  const docs = await getDocuments(project.id);
  const byParent = new Map<string | null, DocumentListItem[]>();
  for (const d of docs) {
    const arr = byParent.get(d.parentId);
    if (arr) arr.push(d);
    else byParent.set(d.parentId, [d]);
  }

  function renderTree(parentId: string | null, depth: number): React.ReactNode {
    const items = byParent.get(parentId);
    if (!items) return null;
    return items.map((d) => (
      <div key={d.id}>
        <Link
          href={`/projects/${project.key}/docs/${d.id}`}
          className="block rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        >
          📄 {d.title}
        </Link>
        {renderTree(d.id, depth + 1)}
      </div>
    ));
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${project.key}`}
            className="rounded-md bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70"
          >
            {project.key}
          </Link>
          <h1 className="text-xl font-semibold">Документы</h1>
        </div>
        {canEdit ? (
          <form action={createDocumentAction.bind(null, project.id, null)}>
            <Button type="submit" size="sm">
              + Документ
            </Button>
          </form>
        ) : null}
      </div>

      <Card className="p-2">
        {docs.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">
            Документов пока нет. Создайте первый.
          </p>
        ) : (
          renderTree(null, 0)
        )}
      </Card>
    </div>
  );
}
