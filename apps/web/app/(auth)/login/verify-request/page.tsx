import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { getT } from '@/lib/i18n';

export default async function VerifyRequestPage() {
  const t = await getT('auth.verifyRequest');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('body')}</CardDescription>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
