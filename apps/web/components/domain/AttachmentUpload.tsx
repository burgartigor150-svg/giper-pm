'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, X } from 'lucide-react';
import { uploadAttachmentAction } from '@/actions/attachments';

type Props = {
  taskId: string;
  projectKey: string;
  taskNumber: number;
};

type UploadJob = {
  id: string;
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
};

/**
 * Drop-zone + paste-listener for adding files to a task. Three input
 * paths share one upload pipeline:
 *
 *   1. Drag files onto the dotted area.
 *   2. Click the area → native file picker.
 *   3. Paste an image from the clipboard (works anywhere on the task
 *      page — typical "screenshot → ⌘V" flow). We attach the global
 *      paste listener while the component is mounted.
 *
 * Each file uploads via its own server-action call so a 24 MB upload
 * doesn't block a 4 KB one. Job rows render under the dropzone with
 * per-file status.
 */
export function AttachmentUpload({ taskId, projectKey, taskNumber }: Props) {
  const router = useRouter();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const enqueue = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const next = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        status: 'pending' as const,
      }));
      setJobs((cur) => [...cur, ...next]);

      // Fire each upload independently. Server action call is awaited
      // inside startTransition so the page doesn't block, but each job
      // updates its own row as soon as it completes.
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        const jobId = next[i]!.id;
        const fd = new FormData();
        fd.set('taskId', taskId);
        fd.set('projectKey', projectKey);
        fd.set('taskNumber', String(taskNumber));
        fd.set('file', file);

        setJobs((cur) =>
          cur.map((j) => (j.id === jobId ? { ...j, status: 'uploading' } : j)),
        );

        startTransition(async () => {
          const res = await uploadAttachmentAction(fd);
          setJobs((cur) =>
            cur.map((j) =>
              j.id === jobId
                ? res.ok
                  ? { ...j, status: 'done' }
                  : { ...j, status: 'error', error: res.error.message }
                : j,
            ),
          );
          if (res.ok) router.refresh();
        });
      }
    },
    [taskId, projectKey, taskNumber, router],
  );

  // Global paste — useful for "Cmd+V the screenshot from clipboard"
  // without focusing the dropzone. Files-only branch; pasting plain
  // text doesn't trigger an upload.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) {
            // macOS clipboard images come in as "image.png" without an
            // extension on Windows; normalise to a sensible name.
            const named =
              f.name && f.name !== ''
                ? f
                : new File([f], `screenshot-${Date.now()}.png`, { type: f.type });
            files.push(named);
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        enqueue(files);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [enqueue]);

  function onPickerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    enqueue(files);
    // Clear input so the same file can be picked again later.
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    enqueue(files);
  }

  function clearDone() {
    setJobs((cur) => cur.filter((j) => j.status !== 'done'));
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={
          'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed px-4 py-6 text-sm transition-colors ' +
          (dragOver
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : 'border-input text-muted-foreground hover:bg-accent')
        }
      >
        <Upload className="h-5 w-5" />
        <div>Перетащите файлы, нажмите чтобы выбрать, или ⌘V из буфера</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={onPickerChange}
        className="hidden"
      />

      {jobs.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs">
          {jobs.map((j) => (
            <li
              key={j.id}
              className={
                'flex items-center gap-2 rounded-md px-2 py-1 ' +
                (j.status === 'error'
                  ? 'bg-red-50 text-red-700'
                  : j.status === 'done'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-muted/40 text-muted-foreground')
              }
            >
              <span className="flex-1 truncate">{j.name}</span>
              <span>
                {j.status === 'pending' && 'в очереди'}
                {j.status === 'uploading' && 'загрузка…'}
                {j.status === 'done' && 'готово'}
                {j.status === 'error' && (j.error ?? 'ошибка')}
              </span>
            </li>
          ))}
          {jobs.some((j) => j.status === 'done') ? (
            <button
              type="button"
              onClick={clearDone}
              className="self-end text-[11px] text-muted-foreground hover:underline"
            >
              <X className="mr-0.5 inline-block h-3 w-3" />
              Скрыть завершённые
            </button>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
