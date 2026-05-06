import { notFound } from 'next/navigation';
import { PlaceholderPage } from '@/components/domain/PlaceholderPage';
import { requireAuth } from '@/lib/auth';
import { canSeeReports } from '@/lib/permissions';
import { getT } from '@/lib/i18n';

export default async function ReportsPage() {
  const user = await requireAuth();
  if (!canSeeReports({ id: user.id, role: user.role })) notFound();

  const t = await getT('reports');
  return <PlaceholderPage title={t('title')} body={t('stub')} />;
}
