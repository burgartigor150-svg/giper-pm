import { LoginForm } from '@/components/domain/LoginForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { getT } from '@/lib/i18n';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; changed?: string }>;
}) {
  const { callbackUrl, changed } = await searchParams;
  const t = await getT('auth.login');
  const tSec = await getT('security');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {changed ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {tSec('changed')}
          </div>
        ) : null}
        <LoginForm callbackUrl={callbackUrl ?? '/dashboard'} />
      </CardContent>
    </Card>
  );
}
