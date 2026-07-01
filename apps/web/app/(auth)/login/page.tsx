import { LoginForm } from '@/components/domain/LoginForm';
import { Bitrix24LoginButton } from '@/components/domain/Bitrix24LoginButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { getT } from '@/lib/i18n';
import { isSsoEnabled, isBitrix24SsoEnabled } from '@/actions/auth';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; changed?: string }>;
}) {
  const { callbackUrl, changed } = await searchParams;
  const t = await getT('auth.login');
  const tSec = await getT('security');
  const [ssoEnabled, b24Enabled] = await Promise.all([isSsoEnabled(), isBitrix24SsoEnabled()]);

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
        {/* When Bitrix24 SSO is configured, that's the ONLY visible login (like
            hr.promo-giper-ai.ru). Until it's configured, fall back to the
            email/password form so nothing breaks during rollout. The Credentials
            provider stays registered as an emergency backend hatch either way. */}
        {b24Enabled ? (
          <Bitrix24LoginButton callbackUrl={callbackUrl ?? '/dashboard'} />
        ) : (
          <LoginForm callbackUrl={callbackUrl ?? '/dashboard'} ssoEnabled={ssoEnabled} />
        )}
      </CardContent>
    </Card>
  );
}
