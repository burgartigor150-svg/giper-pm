'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Code block with a language label + copy button (used by renderMarkdown). */
export function KbCodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  }
  return (
    <div className="my-3 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center justify-between border-b border-neutral-200 bg-muted px-2 py-1 dark:border-neutral-800">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{lang || 'код'}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label="Копировать код">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>
      <pre className="overflow-x-auto bg-muted/40 p-3 text-[0.85em]">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
