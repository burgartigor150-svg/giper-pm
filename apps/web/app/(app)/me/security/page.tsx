import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { getT } from '@/lib/i18n';
import { ChangePasswordForm } from '@/components/domain/ChangePasswordForm';

export default async function SecurityPage() {
  const user = await requireAuth();
  const t = await getT('security');

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { lastPasswordChangeAt: true, mustChangePassword: true },
  });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          {me?.mustChangePassword ? (
            <CardDescription className="text-amber-700">{t('mustChange')}</CardDescription>
          ) : me?.lastPasswordChangeAt ? (
            <CardDescription>
              {t('lastChanged', {
                date: new Date(me.lastPasswordChangeAt).toLocaleDateString('ru-RU'),
              })}
            </CardDescription>
          ) : (
            <CardDescription>{t('neverChanged')}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
