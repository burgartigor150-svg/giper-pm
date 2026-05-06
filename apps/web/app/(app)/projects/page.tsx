import { PlaceholderPage } from '@/components/domain/PlaceholderPage';
import { getT } from '@/lib/i18n';

export default async function ProjectsPage() {
  const t = await getT('projects');
  return <PlaceholderPage title={t('title')} body={t('stub')} />;
}
