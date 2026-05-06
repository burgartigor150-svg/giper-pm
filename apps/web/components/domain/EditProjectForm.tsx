'use client';

import { useActionState } from 'react';
import { Button } from '@giper/ui/components/Button';
import { Input } from '@giper/ui/components/Input';
import { updateProjectAction, archiveProjectAction, type ActionResult } from '@/actions/projects';
import { useT } from '@/lib/useT';

const initialState: ActionResult = { ok: true };

const STATUSES = ['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;

type ProjectInput = {
  id: string;
  name: string;
  description: string | null;
  client: string | null;
  deadline: Date | null;
  status: 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';
};

export function EditProjectForm({ project }: { project: ProjectInput }) {
  const t = useT('projects.form');
  const tDetail = useT('projects.detail');
  const tStatus = useT('projects.status');
  const tErr = useT('projects.errors');

  const updateAction = updateProjectAction.bind(null, project.id);
  const [state, formAction, pending] = useActionState(updateAction, initialState);

  const fieldErrors =
    state && !state.ok && state.error.fieldErrors ? state.error.fieldErrors : undefined;

  async function handleArchive() {
    if (!confirm(tDetail('archiveConfirm'))) return;
    await archiveProjectAction(project.id);
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="name">
          {t('name')}
        </label>
        <Input id="name" name="name" defaultValue={project.name} required />
        {fieldErrors?.name?.[0] ? (
          <p className="text-xs text-destructive">{fieldErrors.name[0]}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="description">
          {t('description')}
        </label>
        <textarea
          id="description"
          name="description"
          defaultValue={project.description ?? ''}
          className="min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="client">
            {t('client')}
          </label>
          <Input id="client" name="client" defaultValue={project.client ?? ''} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor="deadline">
            {t('deadline')}
          </label>
          <Input
            id="deadline"
            name="deadline"
            type="date"
            defaultValue={
              project.deadline ? new Date(project.deadline).toISOString().slice(0, 10) : ''
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="status">
          Статус
        </label>
        <select
          id="status"
          name="status"
          defaultValue={project.status}
          className="h-10 rounded-md border border-input bg-background px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </select>
      </div>

      {state && !state.ok ? (
        <p className="text-sm text-destructive">
          {state.error.code in { CONFLICT: 1, INSUFFICIENT_PERMISSIONS: 1, VALIDATION: 1 }
            ? tErr(state.error.code as 'CONFLICT' | 'INSUFFICIENT_PERMISSIONS' | 'VALIDATION')
            : state.error.message}
        </p>
      ) : state && state.ok ? (
        <p className="text-sm text-muted-foreground">{tDetail('saved')}</p>
      ) : null}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          onClick={handleArchive}
          disabled={project.status === 'ARCHIVED'}
        >
          {tDetail('archive')}
        </Button>
        <Button type="submit" disabled={pending}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
