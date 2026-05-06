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

const isEmailEnabled = !!process.env.RESEND_API_KEY;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Вход в giper-pm</CardTitle>
        <CardDescription>Войдите через Google или по email</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form
          action={async () => {
            'use server';
            await signInWithGoogle(callbackUrl);
          }}
        >
          <Button type="submit" className="w-full" variant="default">
            Войти через Google
          </Button>
        </form>

        {isEmailEnabled ? (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">или</span>
              </div>
            </div>

            <form action={signInWithEmail} className="flex flex-col gap-2">
              <Input
                name="email"
                type="email"
                placeholder="you@giper.fm"
                autoComplete="email"
                required
              />
              <Button type="submit" variant="outline" className="w-full">
                Получить ссылку на email
              </Button>
            </form>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
