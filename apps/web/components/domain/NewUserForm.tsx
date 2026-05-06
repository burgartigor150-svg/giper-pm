'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { createUserAction } from '@/actions/users';
import { useT } from '@/lib/useT';
import { TempPasswordModal } from './TempPasswordModal';

const ROLES = ['ADMIN', 'PM', 'MEMBER', 'VIEWER'] as const;

export function NewUserForm() {
  const t = useT('users.form');
  const tRoles = useT('users.role');
  const tErr = useT('users.errors');

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await createUserAction(null, formData);
      if (!res.ok) {
        const code = res.error.code;
        const known = ['CONFLICT', 'INSUFFICIENT_PERMISSIONS', 'VALIDATION', 'NOT_FOUND'];
        setError(
          known.includes(code)
            ? tErr(code as 'CONFLICT' | 'INSUFFICIENT_PERMISSIONS' | 'VALIDATION' | 'NOT_FOUND')
            : res.error.message,
        );
        if (res.error.fieldErrors) setFieldErrors(res.error.fieldErrors);
        return;
      }
      if (res.data?.tempPassword) setTempPassword(res.data.tempPassword);
    });
  }

  return (
    <>
      <form action={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="name">
            {t('name')}
          </label>
          <Input id="name" name="name" required />
          {fieldErrors.name?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="email">
            {t('email')}
          </label>
          <Input id="email" name="email" type="email" required />
          {fieldErrors.email?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.email[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="role">
            {t('role')}
          </label>
          <select
            id="role"
            name="role"
            defaultValue="MEMBER"
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Link href="/settings/users">
            <Button type="button" variant="outline">
              {t('cancel')}
            </Button>
          </Link>
          <Button type="submit" disabled={pending}>
            {t('submit')}
          </Button>
        </div>
      </form>

      {tempPassword ? (
        <TempPasswordModal
          tempPassword={tempPassword}
          onClose={() => {
            setTempPassword(null);
            window.location.href = '/settings/users';
          }}
        />
      ) : null}
    </>
  );
}
