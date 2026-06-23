import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { KbColumn, KbRow } from './getTables';
import { displayCellValue, type KbRelationMap } from './tableCompute';

/**
 * Dependency-light Markdown → .docx converter for Knowledge Base articles.
 * Mirrors the block grammar of renderMarkdown.tsx (headings, lists, tables,
 * code, blockquotes, callouts `:::`, spoilers `:::details`, HR, and
 * `[[table:ID]]` smart-table embeds) so the exported document matches the
 * on-screen article. Inline: **bold** *italic* `code` [links] and bare URLs.
 */

export type DocxTableData = {
  name: string;
  columns: KbColumn[];
  rows: KbRow[];
  relations: KbRelationMap;
};

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const LIST_RE = /^\s*([-*+]|\d+\.)\s+(.*)$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const TABLE_TOKEN_RE = /^\[\[table:([A-Za-z0-9_-]+)\]\]$/;
const CALLOUT_RE = /^:::\s*([A-Za-z]+)\s*(.*)$/;
const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const INLINE_RE =
  /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(https?:\/\/[^\s)]+)/g;

/** Allowlist link schemes (mirrors renderMarkdown.safeHref) before they reach a
 * .docx relationship target. Returns '' for a rejected scheme. */
function safeHref(href: string): string {
  const v = href.trim();
  return /^(https?:|mailto:|tel:|#|\/)/i.test(v) ? v : '';
}

/** Only http(s)/data:image are valid image srcs (mirrors renderMarkdown). */
function isLinkableImage(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

const CALLOUT_LABEL: Record<string, string> = {
  info: 'ℹ️ Информация',
  note: 'ℹ️ Заметка',
  tip: '💡 Совет',
  success: '✅ Готово',
  warning: '⚠️ Внимание',
  warn: '⚠️ Внимание',
  danger: '⛔ Важно',
};

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

/** Tokenize inline markdown into docx runs (bold/italic/code/link/url + text). */
function inlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  const push = (t: string) => { if (t) out.push(new TextRun(t)); };
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) push(text.slice(last, m.index));
    const [, code, link, bold, em, url] = m;
    if (code) out.push(new TextRun({ text: code.slice(1, -1), font: 'Courier New' }));
    else if (link) {
      const sep = link.indexOf('](');
      const label = link.slice(1, sep);
      const href = safeHref(link.slice(sep + 2, -1));
      // Rejected scheme (javascript:, data:, …) → emit the label as plain text.
      if (href) out.push(new ExternalHyperlink({ children: [new TextRun({ text: label, style: 'Hyperlink' })], link: href }));
      else push(label);
    } else if (bold) out.push(new TextRun({ text: bold.slice(2, -2), bold: true }));
    else if (em) out.push(new TextRun({ text: em.slice(1, -1), italics: true }));
    else if (url) out.push(new ExternalHyperlink({ children: [new TextRun({ text: url, style: 'Hyperlink' })], link: url }));
    last = m.index + m[0].length;
  }
  if (last < text.length) push(text.slice(last));
  return out.length ? out : [new TextRun('')];
}

function para(text: string, opts?: { indent?: number }): Paragraph {
  return new Paragraph({
    children: inlineRuns(text),
    ...(opts?.indent ? { indent: { left: opts.indent } } : {}),
  });
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /\|/.test(line) && /^[\s|:-]+$/.test(line) && /-/.test(line);
}

function textCell(text: string, opts?: { bold?: boolean; shaded?: boolean }): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: opts?.bold })] })],
    ...(opts?.shaded ? { shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' } } : {}),
  });
}

/** Build a docx table from a markdown pipe-table (header + body rows). */
function markdownTable(header: string[], body: string[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h) => textCell(h, { bold: true, shaded: true })) }),
      ...body.map((cells) => new TableRow({
        children: header.map((_, ci) => textCell(cells[ci] ?? '')),
      })),
    ],
  });
}

/** Build a docx table from an embedded smart table (computed cell values). */
function smartTable(t: DocxTableData): Table {
  const cols = t.columns;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: cols.map((c) => textCell(c.name, { bold: true, shaded: true })) }),
      ...t.rows.map((r) => new TableRow({
        children: cols.map((c) => textCell(displayCellValue(c, r, cols, t.relations))),
      })),
    ],
  });
}

/** A callout (`:::kind`) rendered as a shaded single-cell table with a label. */
function calloutBlock(kind: string, lines: string[]): Table {
  const label = CALLOUT_LABEL[kind.toLowerCase()] ?? 'ℹ️ Информация';
  const children: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: label, bold: true })] }),
    ...lines.filter((l) => l.trim()).map((l) => para(l)),
  ];
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [new TableCell({ children, shading: { type: ShadingType.CLEAR, fill: 'EFF6FF' } })] })],
  });
}

type Block = Paragraph | Table;

/** Convert article markdown + resolved embeds into a docx Document body.
 * Exported for unit tests (structural assertions on the block sequence). */
export function blocksFromMarkdown(src: string, tables: Record<string, DocxTableData>): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const at = (i: number) => lines[i] ?? '';
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const iStart = i;
    const line = at(i);

    if (!line.trim()) { i++; continue; }

    // embedded smart table
    const tok = TABLE_TOKEN_RE.exec(line.trim());
    if (tok && tok[1]) {
      const data = tables[tok[1]];
      if (data) {
        blocks.push(new Paragraph({ children: [new TextRun({ text: `${data.name}`, bold: true })] }));
        blocks.push(smartTable(data));
      } else {
        blocks.push(para(`[таблица ${tok[1]}]`));
      }
      i++;
      continue;
    }

    // fenced code
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !at(i).startsWith('```')) { buf.push(at(i)); i++; }
      i++; // closing fence
      for (const cl of buf) {
        blocks.push(new Paragraph({
          children: [new TextRun({ text: cl || ' ', font: 'Courier New', size: 20 })],
          shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
        }));
      }
      continue;
    }

    // callout / spoiler container (::: kind ...) until closing :::
    const callout = CALLOUT_RE.exec(line.trim());
    if (callout && callout[1] && line.trim() !== ':::') {
      const kind = callout[1];
      const inlineTitle = (callout[2] ?? '').trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && at(i).trim() !== ':::') { buf.push(at(i)); i++; }
      i++; // closing :::
      if (kind.toLowerCase() === 'details' || kind.toLowerCase() === 'toggle' || kind.toLowerCase() === 'spoiler') {
        blocks.push(new Paragraph({ children: [new TextRun({ text: inlineTitle || 'Подробнее', bold: true })] }));
        for (const cl of buf) if (cl.trim()) blocks.push(para(cl));
      } else {
        const body = inlineTitle ? [inlineTitle, ...buf] : buf;
        blocks.push(calloutBlock(kind, body));
      }
      continue;
    }

    // heading
    const h = HEADING_RE.exec(line);
    if (h) {
      const level = (h[1] ?? '#').length;
      blocks.push(new Paragraph({ heading: HEADINGS[level - 1], children: inlineRuns((h[2] ?? '').trim()) }));
      i++;
      continue;
    }

    // horizontal rule
    if (HR_RE.test(line)) {
      blocks.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, children: [new TextRun('')] }));
      i++;
      continue;
    }

    // markdown pipe table (row + separator)
    if (line.includes('|') && isTableSeparator(at(i + 1))) {
      const header = splitRow(line);
      i += 2; // header + separator
      const body: string[][] = [];
      while (i < lines.length && at(i).includes('|') && at(i).trim()) { body.push(splitRow(at(i))); i++; }
      blocks.push(markdownTable(header, body));
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(at(i))) { buf.push(at(i).replace(/^\s*>\s?/, '')); i++; }
      blocks.push(new Paragraph({ children: inlineRuns(buf.join(' ')), indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'CBD5E1', space: 8 } } }));
      continue;
    }

    // list (bullet / ordered / task) — contiguous run
    if (LIST_RE.test(line)) {
      let ordinal = 1;
      while (i < lines.length && LIST_RE.test(at(i))) {
        const cur = at(i);
        const task = TASK_RE.exec(cur);
        if (task) {
          const checked = (task[1] ?? '').toLowerCase() === 'x';
          blocks.push(new Paragraph({ children: [new TextRun(`${checked ? '☑' : '☐'} `), ...inlineRuns((task[2] ?? '').trim())], indent: { left: 360 } }));
        } else {
          const lm = LIST_RE.exec(cur)!;
          const marker = lm[1] ?? '-';
          const isOrdered = /\d+\./.test(marker);
          const prefix = isOrdered ? `${ordinal++}. ` : '• ';
          if (!isOrdered) ordinal = 1;
          blocks.push(new Paragraph({ children: [new TextRun(prefix), ...inlineRuns((lm[2] ?? '').trim())], indent: { left: 360 } }));
        }
        i++;
      }
      continue;
    }

    // image on its own line — docx can't embed without fetching bytes, so emit
    // a labelled link (http(s)) or the alt text, mirroring the reader's fallback.
    const img = IMAGE_LINE_RE.exec(line.trim());
    if (img) {
      const alt = (img[1] ?? '').trim() || 'изображение';
      const src = img[2] ?? '';
      if (isLinkableImage(src)) {
        blocks.push(new Paragraph({ children: [new ExternalHyperlink({ children: [new TextRun({ text: `🖼 ${alt}`, style: 'Hyperlink' })], link: src })] }));
      } else {
        blocks.push(new Paragraph({ children: [new TextRun({ text: `🖼 ${alt}`, italics: true })] }));
      }
      i++;
      continue;
    }

    // paragraph (gather until blank / next block start). The stopper mirrors
    // renderMarkdown's so a table / HR / image directly after a text line opens
    // its own block instead of being swallowed as literal text.
    const buf: string[] = [line];
    i++;
    while (
      i < lines.length &&
      at(i).trim() &&
      !at(i).startsWith('```') &&
      !HEADING_RE.test(at(i)) &&
      !LIST_RE.test(at(i)) &&
      !/^\s*>\s?/.test(at(i)) &&
      !HR_RE.test(at(i)) &&
      !(at(i).includes('|') && isTableSeparator(at(i + 1))) &&
      !TABLE_TOKEN_RE.test(at(i).trim()) &&
      !CALLOUT_RE.test(at(i).trim()) &&
      !IMAGE_LINE_RE.test(at(i).trim())
    ) {
      buf.push(at(i));
      i++;
    }
    blocks.push(para(buf.join(' ')));

    if (i === iStart) i++; // forward-progress backstop (paragraph branch already advances i)
  }

  return blocks;
}

/** Render a full article to a .docx Buffer. */
export async function articleToDocx(article: { title: string; content: string | null }, tables: Record<string, DocxTableData>): Promise<Buffer> {
  const body: Block[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: article.title || 'Без названия' })] }),
    ...blocksFromMarkdown(article.content ?? '', tables),
  ];
  const doc = new Document({
    sections: [{ children: body }],
  });
  return Packer.toBuffer(doc);
}
