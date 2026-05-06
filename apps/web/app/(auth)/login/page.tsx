import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { signInWithEmail, signInWithGoogle } from '@/actions/auth';
import { getT } from '@/lib/i18n';

const isEmailEnabled = !!process.env.RESEND_API_KEY;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  const t = await getT('auth.login');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          action={async () => {
            'use server';
            await signInWithGoogle(callbackUrl);
          }}
        >
          <Button type="submit" className="w-full" variant="default">
            {t('googleButton')}
          </Button>
        </form>

        {isEmailEnabled ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">{t('or')}</span>
              </div>
            </div>

            <form action={signInWithEmail} className="flex flex-col gap-2">
              <Input
                name="email"
                type="email"
                placeholder={t('emailPlaceholder')}
                autoComplete="email"
                required
              />
              <Button type="submit" variant="outline" className="w-full">
                {t('emailButton')}
              </Button>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
