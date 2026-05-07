'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, Paperclip } from 'lucide-react';

export type AttachmentLite = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** When the file is mirrored from Bitrix and the proxy can serve it. */
  proxyUrl: string;
  /** Direct upstream link — used only as a download fallback. */
  downloadUrl: string | null;
};

/**
 * Click an attachment row → opens a portaled modal with an inline preview
 * appropriate for the mime type:
 *   - application/pdf → <iframe> (browser PDF viewer, supports range)
 *   - image/* → <img> centered, click-outside to close
 *   - video/*, audio/* → native <video>/<audio> with controls
 *   - text/plain, application/json, text/csv → fetched and rendered as <pre>
 *   - everything else → metadata + a download button
 *
 * The modal is portaled to <body> so it can escape any parent overflow:
 * hidden / transform stacking context.
 */
export function AttachmentViewer({ attachments }: { attachments: AttachmentLite[] }) {
  const [open, setOpen] = useState<AttachmentLite | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-2">
        {attachments.map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-3 rounded-md border bg-muted/20 px-3 py-2"
          >
            <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
            <button
              type="button"
              onClick={() => setOpen(a)}
              className="min-w-0 flex-1 text-left hover:underline"
            >
              <div className="truncate text-sm font-medium">{a.filename}</div>
              <div className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</div>
            </button>
            <a
              href={a.proxyUrl}
              download={a.filename}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100"
              title="Скачать"
            >
              <Download className="h-3 w-3" />
              Скачать
            </a>
          </li>
        ))}
      </ul>
      {open ? <ViewerModal attachment={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function ViewerModal({
  attachment,
  onClose,
}: {
  attachment: AttachmentLite;
  onClose: () => void;
}) {
  // Esc-to-close + lock body scroll while modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // SSR safety — portal can't run server-side.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={attachment.filename}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="mb-3 flex items-center gap-3 text-white">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{attachment.filename}</div>
          <div className="text-xs text-white/70">
            {attachment.mimeType} · {formatBytes(attachment.sizeBytes)}
          </div>
        </div>
        <a
          href={attachment.proxyUrl}
          download={attachment.filename}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
        >
          <Download className="h-4 w-4" /> Скачать
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white hover:bg-white/20"
          aria-label="Закрыть"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div
        className="flex min-h-0 flex-1 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Preview attachment={attachment} />
      </div>
    </div>,
    document.body,
  );
}

function Preview({ attachment }: { attachment: AttachmentLite }) {
  const { mimeType, proxyUrl, filename } = attachment;

  if (mimeType === 'application/pdf') {
    return (
      <iframe
        src={proxyUrl}
        title={filename}
        className="h-full w-full rounded-md bg-white"
      />
    );
  }
  if (mimeType.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={proxyUrl}
        alt={filename}
        className="max-h-full max-w-full rounded-md object-contain"
      />
    );
  }
  if (mimeType.startsWith('video/')) {
    return (
      <video
        src={proxyUrl}
        controls
        className="max-h-full max-w-full rounded-md bg-black"
      />
    );
  }
  if (mimeType.startsWith('audio/')) {
    return <audio src={proxyUrl} controls className="w-full max-w-md" />;
  }
  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/csv' ||
    mimeType === 'application/json'
  ) {
    return <TextPreview url={proxyUrl} />;
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return <DocxPreview url={proxyUrl} />;
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimeType === 'application/vnd.ms-excel'
  ) {
    return <XlsxPreview url={proxyUrl} />;
  }

  return (
    <div className="rounded-md bg-white p-6 text-sm text-foreground">
      <p className="mb-3">
        Предпросмотр для <code className="font-mono">{mimeType}</code> не поддерживается.
      </p>
      <a
        href={proxyUrl}
        download={filename}
        className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-blue-700 hover:bg-blue-100"
      >
        <Download className="h-4 w-4" /> Скачать
      </a>
    </div>
  );
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // Cap at 1 MB so a runaway log doesn't blow up the browser.
        const blob = await r.blob();
        const sliced = blob.size > 1024 * 1024 ? blob.slice(0, 1024 * 1024) : blob;
        return sliced.text();
      })
      .then((t) => !cancelled && setText(t))
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) return <p className="text-sm text-red-300">Ошибка: {error}</p>;
  if (text === null) return <p className="text-sm text-white/70">Загрузка…</p>;
  return (
    <pre className="max-h-full max-w-full overflow-auto rounded-md bg-white p-4 text-xs">
      {text}
    </pre>
  );
}

/**
 * DOCX preview via mammoth — converts the .docx into HTML in the browser.
 * Mammoth is loaded dynamically so the ~120 KB bundle doesn't hit users
 * who never open a Word doc.
 *
 * Caveats: complex layouts (text boxes, drawings, equations) drop down to
 * paragraphs. Good enough for "is this the file I think it is?" — for
 * pixel-perfect editing the user clicks "Скачать".
 */
function DocxPreview({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // mammoth's package.json `browser` field swaps the node-specific
        // files (unzip / fs reads) for browser equivalents at bundle time,
        // so importing the root entry is safe in the client bundle.
        const [mammoth, res] = await Promise.all([import('mammoth'), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const out = await mammoth.convertToHtml({ arrayBuffer: buf });
        if (!cancelled) setHtml(out.value);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) return <p className="text-sm text-red-300">Ошибка: {error}</p>;
  if (html === null) return <p className="text-sm text-white/70">Загрузка документа…</p>;
  return (
    <div className="h-full w-full overflow-auto rounded-md bg-white p-8">
      <div
        // mammoth output is sanitized HTML from a trusted .docx we already
        // proxied through our auth-checked endpoint. Still scoped to a
        // styled container so reset doesn't leak.
        className="prose prose-sm mx-auto max-w-3xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

/**
 * XLSX preview via SheetJS — renders each sheet as an HTML table with a
 * tab switcher. Same dynamic-import pattern as DocxPreview.
 */
function XlsxPreview({ url }: { url: string }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [XLSX, res] = await Promise.all([import('xlsx'), fetch(url)]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const out = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          return { name, html: ws ? XLSX.utils.sheet_to_html(ws) : '' };
        });
        if (!cancelled) setSheets(out);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) return <p className="text-sm text-red-300">Ошибка: {error}</p>;
  if (sheets === null) return <p className="text-sm text-white/70">Загрузка таблицы…</p>;
  if (sheets.length === 0)
    return <p className="text-sm text-white/70">В файле нет листов.</p>;
  const current = sheets[active] ?? sheets[0]!;
  return (
    <div className="flex h-full w-full flex-col rounded-md bg-white">
      {sheets.length > 1 ? (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b bg-muted/30 p-1">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={
                'rounded px-3 py-1 text-xs ' +
                (i === active ? 'bg-white shadow-sm' : 'hover:bg-white/60')
              }
            >
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="flex-1 overflow-auto p-4 text-xs [&_table]:border-collapse [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1"
        dangerouslySetInnerHTML={{ __html: current.html }}
      />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
