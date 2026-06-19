'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@giper/ui/cn';
import { COVER_PALETTE } from '@/lib/covers/palette';
import {
  clearCoverAction,
  setCoverColorAction,
  setCoverImageAction,
} from '@/actions/covers';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
  coverImageKey: string | null;
  coverColor: string | null;
  canEdit: boolean;
};

/** Card-cover control: image upload, colour swatch, or clear. */
export function CoverField({
  taskId,
  projectKey,
  taskNumber,
  coverImageKey,
  coverColor,
  canEdit,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const hasCover = !!coverImageKey || !!coverColor;

  function pickColor(color: string) {
    if (!canEdit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await setCoverColorAction(taskId, projectKey, taskNumber, color);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function uploadImage(file: File) {
    setError(null);
    const fd = new FormData();
    fd.set('taskId', taskId);
    fd.set('projectKey', projectKey);
    fd.set('taskNumber', String(taskNumber));
    fd.set('file', file);
    startTransition(async () => {
      const res = await setCoverImageAction(fd);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  function clear() {
    if (!canEdit || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await clearCoverAction(taskId, projectKey, taskNumber);
      if (res.ok) router.refresh();
      else setError(res.error.message);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Обложка</span>
        {hasCover && canEdit ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Убрать
          </button>
        ) : null}
      </div>

      {coverImageKey ? (
        <div className="overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/covers/${taskId}`}
            alt="Обложка карточки"
            className="h-28 w-full object-cover"
          />
        </div>
      ) : coverColor ? (
        <div className="h-10 w-full rounded-md" style={{ backgroundColor: coverColor }} />
      ) : null}

      {canEdit ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {COVER_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pickColor(c)}
                disabled={pending}
                aria-label={`Цвет обложки ${c}`}
                title="Цвет обложки"
                className={cn(
                  'h-6 w-6 rounded-full border transition-transform hover:scale-110 disabled:opacity-50',
                  coverColor === c ? 'ring-2 ring-ring ring-offset-1' : 'border-black/10',
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={pending}
              className="ml-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              Загрузить
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage(f);
              e.target.value = '';
            }}
          />
        </>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
