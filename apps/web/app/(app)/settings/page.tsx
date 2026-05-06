import { notFound } from 'next/navigation';
import { PlaceholderPage } from '@/components/domain/PlaceholderPage';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { getT } from '@/lib/i18n';

export default async function SettingsPage() {
  const user = await requireAuth();
  if (!canSeeSettings({ id: user.id, role: user.role })) notFound();

  const t = await getT('settings');
  return <PlaceholderPage title={t('title')} body={t('stub')} />;
}
