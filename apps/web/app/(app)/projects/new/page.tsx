import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { canCreateProject } from '@/lib/permissions';
import { getT } from '@/lib/i18n';
import { NewProjectForm } from '@/components/domain/NewProjectForm';

export default async function NewProjectPage() {
  const user = await requireAuth();
  if (!canCreateProject({ id: user.id, role: user.role })) notFound();
  const t = await getT('projects.form');
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <NewProjectForm />
        </CardContent>
      </Card>
    </div>
  );
}
