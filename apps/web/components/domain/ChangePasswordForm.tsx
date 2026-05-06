'use client';

import { useActionState } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { changeOwnPasswordAction, type ActionResult } from '@/actions/users';
import { useT } from '@/lib/useT';

const initial: ActionResult = { ok: true };

export function ChangePasswordForm() {
  const t = useT('security');
  const [state, action, pending] = useActionState(changeOwnPasswordAction, initial);
  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="currentPassword">
          {t('currentPassword')}
        </label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        {fieldErrors?.currentPassword?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.currentPassword[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="newPassword">
          {t('newPassword')}
        </label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        {fieldErrors?.newPassword?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.newPassword[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="confirmPassword">
          {t('confirmPassword')}
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
        {fieldErrors?.confirmPassword?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.confirmPassword[0]}</p>
        ) : null}
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-destructive">{state.error.message}</p>
      ) : state && state.ok && !pending ? null : null}

      <Button type="submit" disabled={pending}>
        {t('submit')}
      </Button>

    </form>
  );
}
