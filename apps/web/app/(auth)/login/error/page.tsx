import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@giper/ui/components/Card';
import { getT } from '@/lib/i18n';

type ReasonKey = 'notAllowed' | 'disabled' | 'default';

const REASON_BY_QUERY: Record<string, ReasonKey> = {
  not_allowed: 'notAllowed',
  disabled: 'disabled',
};

export default async function LoginErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; error?: string }>;
}) {
  const { reason, error } = await searchParams;
  const queryKey = reason ?? error ?? 'default';
  const reasonKey: ReasonKey = REASON_BY_QUERY[queryKey] ?? 'default';

  const t = await getT('auth.error');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`${reasonKey}.title`)}</CardTitle>
        <CardDescription>{t(`${reasonKey}.body`)}</CardDescription>
      </CardHeader>
      <CardContent />
      <CardFooter>
        <Link href="/login" className="w-full">
          <Button variant="outline" className="w-full">
            {t('back')}
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
