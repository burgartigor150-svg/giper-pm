'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { createGroupAction } from '@/actions/userGroups';

/** Inline "create a user group" form for the groups admin list. */
export function CreateGroupForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Название ≥ 2 символов');
      return;
    }
    startTransition(async () => {
      const res = await createGroupAction(name.trim(), description.trim());
      if (res.ok && res.data) {
        setName('');
        setDescription('');
        router.push(`/settings/groups/${res.data.id}`);
      } else if (!res.ok) {
        setError(res.error.message);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Название группы</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          maxLength={80}
          placeholder="Например: Дизайнеры"
          className="h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <label className="flex flex-[2] flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Описание (необязательно)</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
          maxLength={500}
          placeholder="Кого включает группа"
          className="h-9 min-w-[12rem] rounded-md border border-input bg-background px-2 text-sm"
        />
      </label>
      <Button type="button" size="sm" onClick={submit} disabled={pending}>
        <Plus className="mr-1 h-4 w-4" />
        {pending ? 'Создаю…' : 'Создать'}
      </Button>
      {error ? <span className="w-full text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
