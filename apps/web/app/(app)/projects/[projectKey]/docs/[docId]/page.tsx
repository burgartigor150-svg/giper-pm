import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCapsForProject } from '@/lib/capabilities';
import { DomainError } from '@/lib/errors';
import { getDocument } from '@/lib/documents/getDocuments';
import { DocumentEditor } from '@/components/domain/DocumentEditor';

export default async function ProjectDocPage({
  params,
}: {
  params: Promise<{ projectKey: string; docId: string }>;
}) {
  const { projectKey, docId } = await params;
  const user = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: user.id, role: user.role });
  } catch (e) {
    if (
      e instanceof DomainError &&
      (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')
    ) {
      notFound();
    }
    throw e;
  }

  const doc = await getDocument(docId);
  if (!doc || doc.projectId !== project.id) notFound();

  const canEdit = canEditProject(
    { id: user.id, role: user.role },
    { ownerId: project.ownerId, members: project.members },
    await getEffectiveCapsForProject({ id: user.id, role: user.role }, project.id),
  );

  return (
    <div className="py-2">
      <DocumentEditor
        docId={doc.id}
        projectKey={project.key}
        initialTitle={doc.title}
        initialContent={doc.content}
        canEdit={canEdit}
      />
    </div>
  );
}
