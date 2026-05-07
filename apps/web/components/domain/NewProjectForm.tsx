'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { generateProjectKey } from '@giper/shared';
import { createProjectAction, type ActionResult } from '@/actions/projects';
import { useT } from '@/lib/useT';

const initialState: ActionResult = { ok: true };

export function NewProjectForm() {
  const t = useT('projects.form');
  const tErr = useT('projects.errors');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);

  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  function onNameChange(v: string) {
    setName(v);
    if (!keyTouched) setKey(generateProjectKey(v));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="name">
          {t('name')}
        </label>
        <Input
          id="name"
          name="name"
          placeholder={t('namePlaceholder')}
          required
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        {fieldErrors?.name?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="key">
          {t('key')}
        </label>
        <Input
          id="key"
          name="key"
          required
          value={key}
          onChange={(e) => {
            setKeyTouched(true);
            setKey(e.target.value.toUpperCase());
          }}
          maxLength={5}
          className="font-mono uppercase"
        />
        <p className="text-xs text-muted-foreground">{t('keyHint')}</p>
        {fieldErrors?.key?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.key[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="description">
          {t('description')}
        </label>
        <textarea
          id="description"
          name="description"
          placeholder={t('descriptionPlaceholder')}
          className="min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="client">
            {t('client')}
          </label>
          <Input id="client" name="client" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="deadline">
            {t('deadline')}
          </label>
          <Input id="deadline" name="deadline" type="date" />
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-md border border-input bg-muted/30 p-3 text-sm">
        <input
          type="checkbox"
          name="publishToBitrix"
          className="mt-0.5 h-4 w-4 rounded border-input"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">Опубликовать в Bitrix24</span>
          <span className="text-xs text-muted-foreground">
            Создаст рабочую группу в Bitrix24 и свяжет её с этим проектом.
            Если не отметить — можно будет опубликовать позже из настроек проекта.
          </span>
        </span>
      </label>

      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {state.error.code in { CONFLICT: 1, INSUFFICIENT_PERMISSIONS: 1, VALIDATION: 1 }
            ? tErr(state.error.code as 'CONFLICT' | 'INSUFFICIENT_PERMISSIONS' | 'VALIDATION')
            : state.error.message}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Link href="/projects">
          <Button type="button" variant="outline">
            {t('cancel')}
          </Button>
        </Link>
        <Button type="submit" disabled={pending}>
          {t('submit')}
        </Button>
      </div>
    </form>
  );
}
