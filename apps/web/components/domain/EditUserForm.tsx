'use client';

import { useActionState, useState, useTransition } from 'react';
import { Avatar } from '@giper/ui/components/Avatar';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import {
  resetPasswordAction,
  setUserActiveAction,
  updateUserAction,
  type ActionResult,
} from '@/actions/users';
import { useT } from '@/lib/useT';
import { TempPasswordModal } from './TempPasswordModal';

const ROLES = ['ADMIN', 'PM', 'MEMBER', 'VIEWER'] as const;

const initial: ActionResult = { ok: true };

type Props = {
  user: {
    id: string;
    email: string;
    name: string;
    role: 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER';
    image: string | null;
    isActive: boolean;
    timezone: string;
  };
  isSelf: boolean;
  /**
   * Whether the user has at least one position assigned. Used to gate
   * the "Activate" button — activation pushes a welcome notification
   * into Bitrix that quotes role + position, so both must be present
   * before we can fire it.
   */
  hasPositions: boolean;
};

export function EditUserForm({ user, isSelf, hasPositions }: Props) {
  const tForm = useT('users.form');
  const tRoles = useT('users.role');
  const tActions = useT('users.actions');
  const tErr = useT('users.errors');

  const updateAction = updateUserAction.bind(null, user.id);
  const [state, formAction, pending] = useActionState(updateAction, initial);

  const [pendingSide, startSide] = useTransition();
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  function handleReset() {
    if (!confirm(tActions('resetConfirm'))) return;
    setActionError(null);
    startSide(async () => {
      const res = await resetPasswordAction(user.id);
      if (!res.ok) {
        setActionError(res.error.message);
        return;
      }
      if (res.data?.tempPassword) setTempPassword(res.data.tempPassword);
    });
  }

  function handleToggleActive() {
    const target = !user.isActive;
    const confirmText = target ? tActions('activateConfirm') : tActions('deactivateConfirm');
    if (!confirm(confirmText)) return;
    setActionError(null);
    startSide(async () => {
      const res = await setUserActiveAction(user.id, target);
      if (!res.ok) {
        setActionError(res.error.message);
        return;
      }
      window.location.reload();
    });
  }

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Avatar src={user.image} alt={user.name} className="h-12 w-12" />
        <div>
          <div className="font-medium">{user.name}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="name">
            {tForm('name')}
          </label>
          <Input id="name" name="name" defaultValue={user.name} required />
          {fieldErrors?.name?.[0] ? (
            <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="role">
            {tForm('role')}
          </label>
          <select
            id="role"
            name="role"
            defaultValue={user.role}
            className="h-10 rounded-md border border-input bg-background px-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tRoles(r)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="timezone">
            Timezone
          </label>
          <Input id="timezone" name="timezone" defaultValue={user.timezone} />
        </div>

        {state && !state.ok ? (
          <p className="text-sm text-destructive">
            {tErr(
              state.error.code in { CONFLICT: 1, INSUFFICIENT_PERMISSIONS: 1, VALIDATION: 1, NOT_FOUND: 1 }
                ? (state.error.code as 'CONFLICT' | 'INSUFFICIENT_PERMISSIONS' | 'VALIDATION' | 'NOT_FOUND')
                : 'VALIDATION',
            )}
            {state.error.message ? `: ${state.error.message}` : ''}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {tForm('save')}
          </Button>
        </div>
      </form>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-6">
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pendingSide || !user.isActive}
            onClick={handleReset}
          >
            {tActions('resetPassword')}
          </Button>
          <Button
            type="button"
            variant={user.isActive ? 'destructive' : 'default'}
            disabled={
              pendingSide ||
              isSelf ||
              // Activation requires role + at least one position so the
              // welcome push into Bitrix has something to quote.
              (!user.isActive && (!user.role || !hasPositions))
            }
            onClick={handleToggleActive}
          >
            {user.isActive ? tActions('deactivate') : tActions('activate')}
          </Button>
        </div>
        {!user.isActive && (!user.role || !hasPositions) ? (
          <p className="text-xs text-muted-foreground">
            Перед активацией заполните роль и хотя бы одну должность —
            пользователь получит уведомление в Bitrix24 с этими данными.
          </p>
        ) : null}
      </div>

      {tempPassword ? (
        <TempPasswordModal tempPassword={tempPassword} onClose={() => setTempPassword(null)} />
      ) : null}
    </>
  );
}
