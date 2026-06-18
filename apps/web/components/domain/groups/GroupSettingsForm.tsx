'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { deleteGroupAction, updateGroupAction } from '@/actions/userGroups';

type Props = {
  groupId: string;
  initialName: string;
  initialDescription: string;
};

/** Rename / re-describe a group, or delete it. */
export function GroupSettingsForm({ groupId, initialName, initialDescription }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const res = await updateGroupAction(groupId, name.trim(), description.trim());
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  function remove() {
    if (!confirm('Удалить группу? Участники проектов, добавленные через неё, останутся.')) return;
    startTransition(async () => {
      const res = await deleteGroupAction(groupId);
      if (res.ok) router.push('/settings/groups');
      else setError(res.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Название</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            maxLength={80}
            className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">Описание</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            maxLength={500}
            className="h-9 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
          />
        </label>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={remove}
          disabled={pending}
          className="text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Удалить группу
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
