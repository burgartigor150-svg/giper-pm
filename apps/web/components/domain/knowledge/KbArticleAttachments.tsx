'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Upload, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { uploadKbAttachmentAction, deleteKbAttachmentAction } from '@/actions/knowledgeAttachments';
import type { KbAttachment } from '@/lib/knowledge/getAttachments';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`;
  return `${(n / 1024 / 1024).toFixed(1)} МБ`;
}

// Mirror the server limits so we can reject before a wasted round-trip.
const MAX_BYTES = 9 * 1024 * 1024;
const ALLOWED_MIME = /^(image|video|audio|application|text)\//;
const DANGEROUS_MIME = /(text\/html|xhtml|\bsvg\b|svg\+xml|javascript|x-msdownload|x-msdos-program)/i;
function clientReject(file: File): string | null {
  if (file.size === 0) return `${file.name}: пустой файл`;
  if (file.size > MAX_BYTES) return `${file.name}: больше 9 МБ`;
  const m = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.test(m) || DANGEROUS_MIME.test(m)) return `${file.name}: тип не разрешён`;
  return null;
}

/**
 * Article attachments (TEAMLY «вложения»): upload (editors), list with inline
 * open + download, delete (editor or uploader). Bytes are streamed by
 * /api/knowledge/attachments/:id; permission follows the article's space.
 */
export function KbArticleAttachments({
  articleId,
  attachments,
  canEdit,
  currentUserId,
}: {
  articleId: string;
  attachments: KbAttachment[];
  canEdit: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function uploadFiles(files: FileList | File[]) {
    if (busy || pending) return; // one mutation at a time
    const list = Array.from(files);
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) {
        const bad = clientReject(file);
        if (bad) { setError(bad); break; }
        const fd = new FormData();
        fd.set('articleId', articleId);
        fd.set('file', file);
        const res = await uploadKbAttachmentAction(fd);
        if (!res.ok) {
          setError(`${file.name}: ${res.error.message}`);
          break;
        }
      }
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const inFlight = busy || pending;

  function remove(a: KbAttachment) {
    if (busy || pending) return;
    if (!confirm(`Удалить файл «${a.filename}»?`)) return;
    startTransition(async () => {
      const res = await deleteKbAttachmentAction(a.id);
      if (!res.ok) { setError(res.error.message); return; }
      router.refresh();
    });
  }

  if (!canEdit && attachments.length === 0) return null;

  return (
    <section aria-labelledby="kb-attachments-heading" className="flex flex-col gap-3">
      <h2 id="kb-attachments-heading" className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Paperclip className="h-4 w-4" /> Вложения {attachments.length > 0 ? `(${attachments.length})` : ''}
      </h2>

      {attachments.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => {
            const canRemove = canEdit || a.uploadedById === currentUserId;
            return (
              <li key={a.id} className="group flex items-center gap-3 rounded-lg border border-neutral-200 bg-muted/20 px-3 py-2 dark:border-neutral-800">
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <a
                  href={`/api/knowledge/attachments/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:underline"
                  title={a.filename}
                >
                  <span className="truncate text-sm font-medium">{a.filename}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                {canRemove ? (
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    disabled={inFlight}
                    className="shrink-0 rounded-md border border-input p-1 text-muted-foreground opacity-0 transition hover:text-red-600 group-hover:opacity-100 disabled:opacity-50"
                    aria-label="Удалить файл"
                    title="Удалить файл"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canEdit ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files); }}
          className={`flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-xs transition ${
            dragOver ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30' : 'border-neutral-300 text-muted-foreground dark:border-neutral-700'
          }`}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          <button type="button" onClick={() => inputRef.current?.click()} disabled={inFlight} className="font-medium text-foreground hover:underline disabled:opacity-50">
            Загрузить файл
          </button>
          <span>или перетащите сюда (до 9 МБ)</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            disabled={inFlight}
            className="hidden"
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); }}
          />
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
