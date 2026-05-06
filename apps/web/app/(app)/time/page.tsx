import { PlaceholderPage } from '@/components/domain/PlaceholderPage';
import { getT } from '@/lib/i18n';

export default async function TimePage() {
  const t = await getT('time');
  return <PlaceholderPage title={t('title')} body={t('stub')} />;
}
