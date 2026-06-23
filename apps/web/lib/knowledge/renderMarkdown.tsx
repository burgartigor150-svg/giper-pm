import type { ReactNode } from 'react';
import { KbEmbeddedTablePlaceholder } from '@/components/domain/knowledge/KbEmbeddedTable';
import { KbCodeBlock } from '@/components/domain/knowledge/KbCodeBlock';

/** Allow only http(s) and data:image URLs for <img src>; else drop (return ''). */
function safeImgSrc(src: string): string {
  const v = src.trim();
  return /^(https?:\/\/|data:image\/)/i.test(v) ? v : '';
}

const CALLOUT_STYLE: Record<string, { cls: string; icon: string }> = {
  info: { cls: 'border-blue-400 bg-blue-50 dark:bg-blue-950/30', icon: 'ℹ️' },
  note: { cls: 'border-blue-400 bg-blue-50 dark:bg-blue-950/30', icon: 'ℹ️' },
  tip: { cls: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30', icon: '💡' },
  success: { cls: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30', icon: '✅' },
  warning: { cls: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30', icon: '⚠️' },
  warn: { cls: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30', icon: '⚠️' },
  danger: { cls: 'border-red-400 bg-red-50 dark:bg-red-950/30', icon: '⛔' },
};

const TABLE_TOKEN_RE = /^\[\[table:([A-Za-z0-9_-]+)\]\]$/;

/** Extract embedded smart-table ids (`[[table:ID]]` lines) — skips fenced code. */
export function extractTableIds(src: string | null | undefined): string[] {
  if (!src) return [];
  const ids: string[] = [];
  let inFence = false;
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = TABLE_TOKEN_RE.exec(raw.trim());
    if (m && m[1]) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export type RenderMarkdownOptions = { tableEmbeds?: Record<string, ReactNode> };

/**
 * Lightweight, dependency-free Markdown → React renderer for Knowledge Base
 * articles. Deliberately small (no remark/react-markdown) so the KB slice
 * ships without lockfile churn. Supports the TEAMLY-style essentials:
 *
 *   # … ###### headings        **bold**  *italic*  `code`
 *   - / * / + bullet lists     1. ordered lists     - [ ] / - [x] task lists
 *   > blockquotes              ``` fenced code ```   --- horizontal rule
 *   | a | b | tables           [text](url) links     bare URLs
 *
 * Block parsing is line-based; inline parsing is a single tokenizing pass.
 * Nested lists are rendered flat in v1 (indentation collapses) — good enough
 * for reading; the editor stays plain Markdown.
 */

let keySeq = 0;
const k = () => `kb-${keySeq++}`;

/**
 * Allowlist link schemes before they reach an <a href>. Defense in depth: even
 * though React 19 blocks javascript: URLs and browsers block top-level data:
 * navigation, we never emit anything outside http(s)/mailto/tel/anchors/relative
 * — covers the article view, AI answers, and version previews in one place.
 */
function safeHref(href: string): string {
  const v = href.trim();
  return /^(https?:|mailto:|tel:|#|\/)/i.test(v) ? v : '#';
}

// ---- heading slugs (shared by renderer + table of contents) ---------------

/** Stable, anchor-safe slug for a heading's text (keeps unicode letters). */
export function slugifyBase(text: string): string {
  const s = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link → label
    .replace(/[*_`~]/g, '') // strip emphasis markers
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

/** Returns a per-document slugger that disambiguates duplicate headings. */
export function makeSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugifyBase(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

export type KbHeading = { level: number; text: string; slug: string };

/**
 * Extract headings for the table of contents. Mirrors the block parser's
 * fenced-code skipping + slugging so anchors line up with rendered ids.
 */
export function extractHeadings(src: string | null | undefined): KbHeading[] {
  if (!src) return [];
  const slug = makeSlugger();
  const out: KbHeading[] = [];
  let inFence = false;
  for (const raw of src.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING_RE.exec(raw);
    if (h) {
      const text = (h[2] ?? '').trim();
      out.push({ level: (h[1] ?? '#').length, text, slug: slug(text) });
    }
  }
  return out;
}

// ---- inline ---------------------------------------------------------------

const INLINE_RE =
  /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const code = m[1];
    const link = m[2];
    const bold = m[3];
    const em = m[4];
    const url = m[5];
    if (code) {
      out.push(
        <code key={k()} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {code.slice(1, -1)}
        </code>,
      );
    } else if (link) {
      const sep = link.indexOf('](');
      const label = link.slice(1, sep);
      const href = safeHref(link.slice(sep + 2, -1));
      out.push(
        <a key={k()} href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:no-underline dark:text-blue-400">
          {label}
        </a>,
      );
    } else if (bold) {
      out.push(<strong key={k()}>{bold.slice(2, -2)}</strong>);
    } else if (em) {
      out.push(<em key={k()}>{em.slice(1, -1)}</em>);
    } else if (url) {
      out.push(
        <a key={k()} href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:no-underline dark:text-blue-400">
          {url}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---- block helpers --------------------------------------------------------

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const LIST_RE = /^\s*([-*+]|\d+\.)\s+(.*)$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 mb-3 text-2xl font-bold',
  2: 'mt-5 mb-2 text-xl font-bold',
  3: 'mt-4 mb-2 text-lg font-semibold',
  4: 'mt-3 mb-1 text-base font-semibold',
  5: 'mt-3 mb-1 text-sm font-semibold',
  6: 'mt-3 mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground',
};

function isTableSeparator(line: string): boolean {
  return /\|/.test(line) && /^[\s|:-]+$/.test(line) && /-/.test(line);
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

// ---- main -----------------------------------------------------------------

export function renderMarkdown(
  src: string | null | undefined,
  options: RenderMarkdownOptions = {},
): ReactNode {
  if (!src || !src.trim()) return null;
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const at = (idx: number): string => lines[idx] ?? '';
  const slug = makeSlugger();
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const iStart = i;
    const line = at(i);

    // blank
    if (!line.trim()) {
      i++;
      continue;
    }

    // embedded smart-table token: [[table:ID]] on its own line
    const tableTok = TABLE_TOKEN_RE.exec(line.trim());
    if (tableTok && tableTok[1]) {
      const id = tableTok[1];
      const embed = options.tableEmbeds?.[id];
      blocks.push(
        <div key={k()}>{embed !== undefined ? embed : <KbEmbeddedTablePlaceholder id={id} />}</div>,
      );
      i++;
      continue;
    }

    // fenced code block (``` optionally followed by a language)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !at(i).startsWith('```')) {
        buf.push(at(i));
        i++;
      }
      i++; // closing fence
      blocks.push(<KbCodeBlock key={k()} code={buf.join('\n')} lang={lang || undefined} />);
      continue;
    }

    // directive block: :::info | :::warning | :::success | :::tip | :::details Заголовок
    const directive = /^:::(\w+)(?:\s+(.*))?$/.exec(line.trim());
    if (directive && directive[1]) {
      const kind = directive[1].toLowerCase();
      const title = (directive[2] ?? '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && at(i).trim() !== ':::') {
        buf.push(at(i));
        i++;
      }
      i++; // closing :::
      const inner = renderMarkdown(buf.join('\n'), options);
      if (kind === 'details' || kind === 'toggle' || kind === 'spoiler') {
        blocks.push(
          <details key={k()} className="my-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <summary className="cursor-pointer text-sm font-medium">{title || 'Подробнее'}</summary>
            <div className="mt-2">{inner}</div>
          </details>,
        );
      } else {
        const style = CALLOUT_STYLE[kind] ?? CALLOUT_STYLE.info!;
        blocks.push(
          <div key={k()} className={`my-3 rounded-md border-l-4 p-3 text-sm ${style.cls}`}>
            <div className="flex items-start gap-2">
              <span className="shrink-0">{style.icon}</span>
              <div className="min-w-0 flex-1">
                {title ? <p className="mb-1 font-semibold">{title}</p> : null}
                {inner}
              </div>
            </div>
          </div>,
        );
      }
      continue;
    }

    // image block on its own line: ![alt](url). Always advances i — when the src
    // is rejected by safeImgSrc we still consume the line (render the alt text),
    // never falling through, so the parser can't stall.
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(line.trim());
    if (img && img[2]) {
      const alt = img[1] ?? '';
      const src = safeImgSrc(img[2]);
      blocks.push(
        src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={k()} src={src} alt={alt} className="my-3 max-w-full rounded-md border border-neutral-200 dark:border-neutral-800" />
        ) : (
          <p key={k()} className="my-2 text-sm text-muted-foreground">{alt || 'изображение'}</p>
        ),
      );
      i++;
      continue;
    }

    // heading
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = (h[1] ?? '#').length;
      const text = h[2] ?? '';
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      blocks.push(
        <Tag key={k()} id={slug(text)} className={`scroll-mt-20 ${HEADING_CLASS[level]}`}>
          {renderInline(text)}
        </Tag>,
      );
      i++;
      continue;
    }

    // horizontal rule
    if (HR_RE.test(line)) {
      blocks.push(<hr key={k()} className="my-4 border-neutral-200 dark:border-neutral-800" />);
      i++;
      continue;
    }

    // table: header row + separator row
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(at(i + 1))) {
      const header = splitRow(line);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && at(i).includes('|') && at(i).trim()) {
        rows.push(splitRow(at(i)));
        i++;
      }
      blocks.push(
        <div key={k()} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((cell) => (
                  <th key={k()} className="border border-neutral-300 bg-muted px-2 py-1 text-left font-semibold dark:border-neutral-700">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={k()}>
                  {header.map((_, ci) => (
                    <td key={k()} className="border border-neutral-300 px-2 py-1 align-top dark:border-neutral-700">
                      {renderInline(row[ci] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // blockquote
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && at(i).startsWith('>')) {
        buf.push(at(i).replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={k()} className="my-3 border-l-4 border-neutral-300 pl-3 text-muted-foreground dark:border-neutral-700">
          {renderInline(buf.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // lists (task / unordered / ordered) — consecutive list lines
    if (LIST_RE.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const items: ReactNode[] = [];
      let hasTask = false;
      while (i < lines.length && LIST_RE.test(at(i))) {
        const cur = at(i);
        const task = TASK_RE.exec(cur);
        if (task) {
          hasTask = true;
          const checked = (task[1] ?? '').toLowerCase() === 'x';
          items.push(
            <li key={k()} className="flex items-start gap-2">
              <input type="checkbox" checked={checked} readOnly className="mt-1" />
              <span className={checked ? 'text-muted-foreground line-through' : ''}>{renderInline(task[2] ?? '')}</span>
            </li>,
          );
        } else {
          const item = LIST_RE.exec(cur);
          items.push(<li key={k()}>{renderInline(item?.[2] ?? '')}</li>);
        }
        i++;
      }
      if (hasTask) {
        blocks.push(<ul key={k()} className="my-2 space-y-1">{items}</ul>);
      } else if (ordered) {
        blocks.push(<ol key={k()} className="my-2 list-decimal space-y-1 pl-6">{items}</ol>);
      } else {
        blocks.push(<ul key={k()} className="my-2 list-disc space-y-1 pl-6">{items}</ul>);
      }
      continue;
    }

    // paragraph — gather until blank or a block starter
    const buf: string[] = [];
    while (
      i < lines.length &&
      at(i).trim() &&
      !at(i).startsWith('```') &&
      !at(i).startsWith('>') &&
      !HEADING_RE.test(at(i)) &&
      !HR_RE.test(at(i)) &&
      !LIST_RE.test(at(i)) &&
      !at(i).trim().startsWith(':::') &&
      !TABLE_TOKEN_RE.test(at(i).trim()) &&
      !/^!\[[^\]]*\]\([^)\s]+\)$/.test(at(i).trim()) &&
      !(at(i).includes('|') && i + 1 < lines.length && isTableSeparator(at(i + 1)))
    ) {
      buf.push(at(i));
      i++;
    }
    // Forward-progress guard: a line that some stop-predicate flagged but no
    // block branch consumed (e.g. a stray ':::', or an image with a rejected
    // src) leaves buf empty — render it as a literal line and advance so the
    // outer loop can never spin on the same index (was a hard browser hang).
    if (buf.length === 0) {
      blocks.push(
        <p key={k()} className="my-2 leading-relaxed">
          {renderInline(at(i))}
        </p>,
      );
      i++;
      continue;
    }
    blocks.push(
      <p key={k()} className="my-2 leading-relaxed">
        {renderInline(buf.join('\n'))}
      </p>,
    );

    // Absolute backstop: no branch should leave i unchanged, but if one ever
    // does, force progress rather than hang the render thread.
    if (i === iStart) i++;
  }

  return <>{blocks}</>;
}
