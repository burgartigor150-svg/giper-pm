import type { ReactNode } from 'react';

/**
 * Render text that may contain Bitrix24-style BBCode plus bare URLs as
 * React nodes with anchor tags for links.
 *
 * Supported tokens:
 *   [URL=https://example.com]label[/URL]   → <a href="https://example.com">label</a>
 *   [URL]https://example.com[/URL]         → <a href="https://example.com">https://example.com</a>
 *   bare https://… or http://…             → <a href="…">…</a>
 *
 * Anything else is left as plain text. Newlines must be preserved by the
 * caller via `whitespace-pre-wrap` (we don't insert <br>).
 *
 * Why this lives in the renderer and not in the sync step: the database
 * column stores the original Bitrix payload as-is so we can round-trip
 * edits; the BBCode unwrap is purely cosmetic and belongs at display
 * time.
 */
export function renderRichText(input: string | null | undefined): ReactNode {
  if (!input) return null;

  // Pattern alternation:
  //   1. [URL=link]label[/URL]
  //   2. [URL]link[/URL]
  //   3. bare http(s)://…
  // Use \S+ for the link to avoid greedy matches across newlines/spaces.
  const re =
    /\[URL=([^\]]+?)\]([\s\S]*?)\[\/URL\]|\[URL\]([\s\S]*?)\[\/URL\]|(https?:\/\/[^\s<>"']+)/gi;

  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) {
      out.push(input.slice(lastIndex, match.index));
    }
    const [, urlA, labelA, urlB, bareUrl] = match;
    const href = sanitizeHref(urlA ?? urlB ?? bareUrl ?? '');
    const label = (labelA ?? urlB ?? bareUrl ?? '').trim();
    if (href) {
      out.push(
        <a
          key={`l${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline underline-offset-2 hover:text-blue-700 break-all"
        >
          {label || href}
        </a>,
      );
    } else {
      out.push(match[0]);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < input.length) {
    out.push(input.slice(lastIndex));
  }

  return out.length === 0 ? input : out;
}

function sanitizeHref(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // Block javascript: / data: / vbscript: schemes — only allow http(s),
  // mailto, tel. The first three can execute in some browsers when
  // rendered as anchors.
  if (/^\s*(javascript|data|vbscript):/i.test(v)) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  // Bare host without scheme — assume https.
  if (/^[\w.-]+\.[a-z]{2,}/i.test(v)) return `https://${v}`;
  return null;
}
