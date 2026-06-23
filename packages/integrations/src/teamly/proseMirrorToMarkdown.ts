/**
 * Convert a TEAMLY article body (ProseMirror / TipTap JSON document) into the
 * Markdown dialect the giper-pm Knowledge Base stores and renders
 * (renderMarkdown.tsx + KbRichEditor): headings, lists, task lists, tables,
 * blockquotes, code, images, links, `:::callout` / `:::details` blocks.
 *
 * Robust by design — TEAMLY's node vocabulary isn't fully documented, so any
 * UNKNOWN block node recurses into its content and any UNKNOWN mark degrades to
 * plain text. Nothing throws: a malformed doc yields ''.
 */

export type PMMark = { type?: string; attrs?: Record<string, unknown> | null };
export type PMNode = {
  type?: string;
  text?: string;
  content?: PMNode[];
  marks?: PMMark[] | null;
  attrs?: Record<string, unknown> | null;
};

const CALLOUT_KINDS = new Set(['info', 'note', 'tip', 'success', 'warning', 'warn', 'danger']);

function attr(node: PMNode | undefined, key: string): unknown {
  return node?.attrs && typeof node.attrs === 'object' ? (node.attrs as Record<string, unknown>)[key] : undefined;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

// ---- inline -----------------------------------------------------------------

function applyMarks(text: string, marks: PMMark[] | null | undefined): string {
  if (!marks || marks.length === 0) return text;
  let out = text;
  // code first (so emphasis wraps the backticks), then link outermost.
  const ordered = [...marks].sort((a, b) => markRank(a.type) - markRank(b.type));
  for (const m of ordered) {
    switch (m.type) {
      case 'code':
      case 'inlineCode':
        out = '`' + out + '`';
        break;
      case 'bold':
      case 'strong':
        out = '**' + out + '**';
        break;
      case 'italic':
      case 'em':
        out = '*' + out + '*';
        break;
      case 'strike':
      case 'strikethrough':
      case 's':
        out = '~~' + out + '~~';
        break;
      case 'link':
      case 'a': {
        const href = str(m.attrs && (m.attrs.href ?? m.attrs.url));
        if (href) out = `[${out}](${href})`;
        break;
      }
      // underline / fontSize / fontStyle / textColor / bgColor / highlight →
      // Markdown can't express these; keep the text plain.
      default:
        break;
    }
  }
  return out;
}
function markRank(type?: string): number {
  if (type === 'code' || type === 'inlineCode') return 0;
  if (type === 'link' || type === 'a') return 9;
  return 5;
}

const ZWSP = '​';

/**
 * Neutralize giper-pm structural tokens that appear inside TEAMLY *text* (not
 * real structure nodes) so imported prose can't fabricate a smart-table embed
 * or a callout/details block when rendered. A zero-width space is visually
 * invisible but breaks the renderer's anchored token regexes.
 */
function escapeText(text: string): string {
  return text
    .replace(/\[\[table:/g, `[${ZWSP}[table:`) // smart-table embed token
    .replace(/:::/g, `:${ZWSP}::`); // callout / :::details directive
}

function inlineToMd(node: PMNode): string {
  if (node.type === 'text') return applyMarks(escapeText(node.text ?? ''), node.marks);
  if (node.type === 'hardBreak' || node.type === 'hard_break') return '  \n';
  if (node.type === 'image') return imageMd(node); // inline image
  if (Array.isArray(node.content)) return node.content.map(inlineToMd).join('');
  return node.text ?? '';
}
function inlineChildren(node: PMNode): string {
  return (node.content ?? []).map(inlineToMd).join('').trim();
}

function imageMd(node: PMNode): string {
  const src = str(attr(node, 'src'));
  const alt = str(attr(node, 'alt')) || str(attr(node, 'title'));
  return src ? `![${alt}](${src})` : '';
}

// ---- block ------------------------------------------------------------------

function textContent(node: PMNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textContent).join('');
}

function indent(block: string, prefix: string, firstPrefix = prefix): string {
  const lines = block.split('\n');
  return lines.map((l, i) => (i === 0 ? firstPrefix : prefix) + l).join('\n');
}

function listToMd(node: PMNode, ordered: boolean, start = 1): string {
  const items = node.content ?? [];
  const out: string[] = [];
  let n = ordered ? (typeof attr(node, 'start') === 'number' ? (attr(node, 'start') as number) : start) : 0;
  for (const item of items) {
    const marker = ordered ? `${n}. ` : '- ';
    const pad = ' '.repeat(marker.length);
    out.push(indent(listItemBody(item), pad, marker));
    n += 1;
  }
  return out.join('\n');
}

function taskListToMd(node: PMNode): string {
  return (node.content ?? [])
    .map((item) => {
      const checked = attr(item, 'checked') === true;
      const marker = checked ? '- [x] ' : '- [ ] ';
      return indent(listItemBody(item), '  ', marker);
    })
    .join('\n');
}

/** A list/task item: render its child blocks; nested lists indent under it. */
function listItemBody(item: PMNode): string {
  const parts: string[] = [];
  for (const child of item.content ?? []) {
    if (child.type === 'bulletList') parts.push(listToMd(child, false));
    else if (child.type === 'orderedList') parts.push(listToMd(child, true));
    else if (child.type === 'taskList') parts.push(taskListToMd(child));
    else parts.push(blockToMd(child));
  }
  return parts.filter((p) => p !== '').join('\n');
}

function tableToMd(node: PMNode): string {
  const rows = (node.content ?? []).filter((r) => r.type === 'tableRow' || r.type === 'table_row');
  if (rows.length === 0) return '';
  const cellText = (row: PMNode): string[] =>
    (row.content ?? []).map((cell) => inlineChildren(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' ');
  const header = cellText(rows[0]!);
  const width = header.length || 1;
  const sep = Array.from({ length: width }, () => '---');
  const body = rows.slice(1).map((r) => {
    const cells = cellText(r);
    while (cells.length < width) cells.push(' ');
    return `| ${cells.slice(0, width).join(' | ')} |`;
  });
  return [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...body].join('\n');
}

function calloutMd(node: PMNode): string {
  const raw = (str(attr(node, 'kind')) || str(attr(node, 'type')) || str(attr(node, 'variant')) || 'info').toLowerCase();
  const kind = CALLOUT_KINDS.has(raw) ? raw : 'info';
  const inner = (node.content ?? []).map(blockToMd).filter((s) => s !== '').join('\n\n');
  return `:::${kind}\n${inner}\n:::`;
}

function spoilerMd(node: PMNode): string {
  const title = str(attr(node, 'title')) || str(attr(node, 'summary')) || 'Подробнее';
  const inner = (node.content ?? []).map(blockToMd).filter((s) => s !== '').join('\n\n');
  return `:::details ${title}\n${inner}\n:::`;
}

function blockToMd(node: PMNode): string {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(Math.max(Number(attr(node, 'level')) || 1, 1), 6);
      return '#'.repeat(level) + ' ' + inlineChildren(node);
    }
    case 'paragraph':
    case 'text': {
      if (node.type === 'text') return inlineToMd(node);
      const line = inlineChildren(node);
      // A paragraph whose literal text begins with a block marker (#, list/quote
      // marker, ``` fence, --- rule, | table) would be reinterpreted as that
      // structure by the reader — prefix an invisible ZWSP to keep it as text.
      return /^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|```|~~~|---|\||={2,}\s*$)/.test(line) ? ZWSP + line : line;
    }
    case 'bulletList':
    case 'bullet_list':
      return listToMd(node, false);
    case 'orderedList':
    case 'ordered_list':
      return listToMd(node, true);
    case 'taskList':
    case 'task_list':
    case 'checkList':
      return taskListToMd(node);
    case 'blockquote':
    case 'blockQuote':
      return (node.content ?? [])
        .map(blockToMd)
        .filter((s) => s !== '')
        .join('\n\n')
        .split('\n')
        .map((l) => (l ? '> ' + l : '>'))
        .join('\n');
    case 'codeBlock':
    case 'code_block':
      return '```' + str(attr(node, 'language') || attr(node, 'lang')) + '\n' + textContent(node).replace(/\n$/, '') + '\n```';
    case 'horizontalRule':
    case 'horizontal_rule':
    case 'divider':
      return '---';
    case 'image':
      return imageMd(node);
    case 'table':
      return tableToMd(node);
    case 'callout':
    case 'panel':
    case 'note':
    case 'infoBlock':
    case 'info_block':
      return calloutMd(node);
    case 'details':
    case 'toggle':
    case 'spoiler':
    case 'expand':
      return spoilerMd(node);
    case 'hardBreak':
    case 'hard_break':
      return '';
    default:
      // Unknown node: keep its text / recurse its content so nothing is lost.
      if (node.text != null) return inlineToMd(node);
      if (Array.isArray(node.content)) return node.content.map(blockToMd).filter((s) => s !== '').join('\n\n');
      return '';
  }
}

// ---- entry ------------------------------------------------------------------

/**
 * @param doc a ProseMirror doc — JSON string or parsed object (`{type:'doc',content:[…]}`)
 * @returns trimmed Markdown (ends with a single trailing newline), or '' if empty/invalid.
 */
export function proseMirrorToMarkdown(doc: string | PMNode | null | undefined): string {
  let root: PMNode | null = null;
  if (typeof doc === 'string') {
    const t = doc.trim();
    if (!t) return '';
    try {
      root = JSON.parse(t) as PMNode;
    } catch {
      return '';
    }
  } else if (doc && typeof doc === 'object') {
    root = doc;
  }
  if (!root) return '';
  const blocks = (root.content ?? []).map(blockToMd).filter((s) => s.trim() !== '');
  const md = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return md ? md + '\n' : '';
}
