'use client';

import { useActionState } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { signInWithCredentials, signInWithGoogle, type SignInResult } from '@/actions/auth';
import { useT } from '@/lib/useT';

const initial: SignInResult = { ok: true };

export function LoginForm({
  callbackUrl,
  ssoEnabled = false,
}: {
  callbackUrl: string;
  ssoEnabled?: boolean;
}) {
  const t = useT('auth.login');
  const [state, action, pending] = useActionState(signInWithCredentials, initial);

  return (
    <div className="flex flex-col gap-3">
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          {t('password')}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {state.error === 'INVALID_CREDENTIALS' ? t('invalidCredentials') : t('genericError')}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {t('signInButton')}
      </Button>
    </form>

    {ssoEnabled ? (
      <>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          или
          <span className="h-px flex-1 bg-border" />
        </div>
        <form action={signInWithGoogle.bind(null, callbackUrl)}>
          <Button type="submit" variant="outline" className="w-full">
            Войти через Google
          </Button>
        </form>
      </>
    ) : null}
    </div>
  );
}
