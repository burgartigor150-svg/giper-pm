'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
// Leaf imports only — NOT the '@/lib/capabilities' barrel (which re-exports the
// prisma/react resolver and would pull server code into this client bundle).
import { CAPABILITY_GROUPS, HIGH_TRUST_CAPS, type CapabilityKey } from '@/lib/capabilities/catalog';
import { BASELINE_CAPS } from '@/lib/capabilities/baseline';
import { createCustomRoleAction, updateCustomRoleAction } from '@/actions/customRoles';

type Role = 'ADMIN' | 'PM' | 'MEMBER' | 'VIEWER';
const BASE_ROLES: Role[] = ['VIEWER', 'MEMBER', 'PM', 'ADMIN'];

type Props = {
  mode: 'create' | 'edit';
  initial?: {
    id: string;
    name: string;
    description: string | null;
    baseRole: Role;
    capabilities: CapabilityKey[];
  };
};

/**
 * Define a custom role as an explicit capability set. "Prefill from base" seeds
 * the checklist from a UserRole's baseline so an admin starts from a known
 * profile and then grants/restricts. The stored set IS the role (replace
 * semantics) — unchecking a baseline cap genuinely restricts.
 */
export function RoleBuilder({ mode, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [baseRole, setBaseRole] = useState<Role>(initial?.baseRole ?? 'MEMBER');
  const [caps, setCaps] = useState<Set<CapabilityKey>>(new Set(initial?.capabilities ?? []));
  const [error, setError] = useState<string | null>(null);

  function toggle(key: CapabilityKey) {
    setCaps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function prefillFromBase() {
    setCaps(new Set(BASELINE_CAPS[baseRole]));
  }

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      baseRole,
      capabilities: [...caps],
    };
    startTransition(async () => {
      const res =
        mode === 'create'
          ? await createCustomRoleAction(payload)
          : await updateCustomRoleAction(initial!.id, payload);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      router.push('/settings/roles');
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="role-name">Название роли</label>
          <Input id="role-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
            placeholder="Напр. «Тимлид без настроек»" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="role-base">Базовая роль (шаблон)</label>
          <div className="flex gap-2">
            <select
              id="role-base"
              value={baseRole}
              onChange={(e) => setBaseRole(e.target.value as Role)}
              className="h-10 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            >
              {BASE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button type="button" variant="outline" size="sm" onClick={prefillFromBase}>
              Заполнить по шаблону
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="role-desc">Описание</label>
        <Input id="role-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)}
          placeholder="Для чего эта роль" />
      </div>

      <p className="text-xs text-muted-foreground">
        Роль = точный набор прав. Отметьте то, что разрешено — снятая галочка с права
        базовой роли действительно его <b>отнимает</b>. Права уровня проекта (видеть
        свой проект/задачу) этой ролью не управляются.
      </p>

      <div className="space-y-4">
        {CAPABILITY_GROUPS.map((group) => (
          <div key={group.area} className="rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-semibold">{group.area}</div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {group.capabilities.map((c) => {
                const high = HIGH_TRUST_CAPS.has(c.key);
                return (
                  <label key={c.key} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={caps.has(c.key)}
                      onChange={() => toggle(c.key)}
                    />
                    <span>
                      {c.label}
                      {high ? <span className="ml-1 text-xs text-amber-600" title="Чувствительное право">⚠</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" disabled={pending} onClick={submit}>
          {pending ? 'Сохраняю…' : mode === 'create' ? 'Создать роль' : 'Сохранить'}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.push('/settings/roles')}>
          Отмена
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{caps.size} прав выбрано</span>
      </div>
    </div>
  );
}
