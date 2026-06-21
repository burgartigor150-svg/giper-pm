import type { ReactNode } from 'react';

export type MentionLookup = Map<string, { id: string; name: string }>;

export type RenderRichTextOptions = {
  /**
   * Optional id→user lookup. When passed, `@<userId>` tokens that match
   * are rendered as a clickable mention pill. Tokens whose id isn't in
   * the map fall back to the raw "@id" string so we don't silently swallow
   * the user's input.
   */
  mentions?: MentionLookup;
};

/**
 * Render text that may contain Bitrix24-style BBCode, bare URLs, and
 * @<cuid> mentions as React nodes.
 *
 * Supported tokens:
 *   [URL=https://example.com]label[/URL]   → <a href="https://example.com">label</a>
 *   [URL]https://example.com[/URL]         → <a href="https://example.com">https://example.com</a>
 *   bare https://… or http://…             → <a href="…">…</a>
 *   @<cuid>                                → mention pill (when in map)
 *
 * Anything else is left as plain text. Newlines must be preserved by the
 * caller via `whitespace-pre-wrap` (we don't insert <br>).
 *
 * Why this lives in the renderer and not in the sync step: the database
 * column stores the original Bitrix payload as-is so we can round-trip
 * edits; the BBCode unwrap is purely cosmetic and belongs at display
 * time.
 */
export function renderRichText(
  input: string | null | undefined,
  options: RenderRichTextOptions = {},
): ReactNode {
  if (!input) return null;

  // Pattern alternation:
  //   1. [label](url)  — markdown link (what convertBitrixMarkup emits)
  //   2. [URL=link]label[/URL]
  //   3. [URL]link[/URL]
  //   4. bare http(s)://…
  //   5. @<cuid>  — id-style mention (rendered iff present in map)
  const re =
    /\[([^\]]*)\]\(([^)\s]+)\)|\[URL=([^\]]+?)\]([\s\S]*?)\[\/URL\]|\[URL\]([\s\S]*?)\[\/URL\]|(https?:\/\/[^\s<>"']+)|@([a-z0-9]{24,})\b/gi;

  const out: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) {
      out.push(input.slice(lastIndex, match.index));
    }
    const [, mdLabel, mdUrl, urlA, labelA, urlB, bareUrl, mentionId] = match;
    if (mdUrl !== undefined) {
      // Markdown link. A relative/invalid href (e.g. a leftover Bitrix action
      // path) can't be sanitized → render just the label so we never show raw
      // "[text](…)" markup to the user.
      const href = sanitizeHref(mdUrl);
      const label = (mdLabel ?? '').trim();
      if (href) {
        out.push(
          <a
            key={`md${key++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline underline-offset-2 hover:text-blue-700 break-all"
          >
            {label || href}
          </a>,
        );
      } else if (label) {
        out.push(label);
      }
    } else if (mentionId) {
      const u = options.mentions?.get(mentionId);
      if (u) {
        out.push(
          <a
            key={`m${key++}`}
            href={`/messages/dm/${u.id}`}
            className="rounded bg-blue-100 px-1 py-0.5 text-blue-800 hover:bg-blue-200"
          >
            @{u.name}
          </a>,
        );
      } else {
        out.push(match[0]);
      }
    } else {
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
