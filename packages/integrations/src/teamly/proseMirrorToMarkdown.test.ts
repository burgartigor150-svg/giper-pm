import { describe, it, expect } from 'vitest';
import { proseMirrorToMarkdown, type PMNode } from './proseMirrorToMarkdown';

const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });
const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content });
const t = (text: string, marks?: { type: string; attrs?: Record<string, unknown> }[]): PMNode => ({ type: 'text', text, marks });

describe('proseMirrorToMarkdown', () => {
  it('returns empty string for empty / invalid input', () => {
    expect(proseMirrorToMarkdown(null)).toBe('');
    expect(proseMirrorToMarkdown('')).toBe('');
    expect(proseMirrorToMarkdown('not json')).toBe('');
    expect(proseMirrorToMarkdown(doc())).toBe('');
    expect(proseMirrorToMarkdown('{"type":"doc","content":[]}')).toBe('');
  });

  it('headings and paragraphs', () => {
    const md = proseMirrorToMarkdown(
      doc({ type: 'heading', attrs: { level: 2 }, content: [t('Заголовок')] }, p(t('Абзац текста.'))),
    );
    expect(md).toBe('## Заголовок\n\nАбзац текста.\n');
  });

  it('inline marks: bold, italic, code, strike, link', () => {
    const md = proseMirrorToMarkdown(
      doc(
        p(
          t('обычный '),
          t('жирный', [{ type: 'bold' }]),
          t(' '),
          t('курсив', [{ type: 'italic' }]),
          t(' '),
          t('код', [{ type: 'code' }]),
          t(' '),
          t('зачёрк', [{ type: 'strike' }]),
          t(' '),
          t('ссылка', [{ type: 'link', attrs: { href: 'https://e.com' } }]),
        ),
      ),
    );
    expect(md).toBe('обычный **жирный** *курсив* `код` ~~зачёрк~~ [ссылка](https://e.com)\n');
  });

  it('ignores marks Markdown cannot express (underline/color) but keeps text', () => {
    const md = proseMirrorToMarkdown(doc(p(t('подчёркнутый', [{ type: 'underline' }, { type: 'textColor', attrs: { color: 'red' } }]))));
    expect(md).toBe('подчёркнутый\n');
  });

  it('bullet and ordered lists, including nesting', () => {
    const li = (text: string, ...extra: PMNode[]): PMNode => ({ type: 'listItem', content: [p(t(text)), ...extra] });
    const md = proseMirrorToMarkdown(
      doc(
        { type: 'bulletList', content: [li('первый'), li('второй', { type: 'bulletList', content: [li('вложенный')] })] },
        { type: 'orderedList', content: [li('раз'), li('два')] },
      ),
    );
    expect(md).toBe('- первый\n- второй\n  - вложенный\n\n1. раз\n2. два\n');
  });

  it('task list with checked/unchecked items', () => {
    const item = (text: string, checked: boolean): PMNode => ({ type: 'taskItem', attrs: { checked }, content: [p(t(text))] });
    const md = proseMirrorToMarkdown(doc({ type: 'taskList', content: [item('сделано', true), item('нет', false)] }));
    expect(md).toBe('- [x] сделано\n- [ ] нет\n');
  });

  it('blockquote, code block, horizontal rule, image', () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: 'blockquote', content: [p(t('цитата'))] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [t('const x = 1;')] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: 'https://e.com/a.png', alt: 'картинка' } },
      ),
    );
    expect(md).toBe('> цитата\n\n```js\nconst x = 1;\n```\n\n---\n\n![картинка](https://e.com/a.png)\n');
  });

  it('percent-encodes spaces and parens in an image src (else markdown / the T4 localizer would break)', () => {
    const md = proseMirrorToMarkdown(
      doc({ type: 'image', attrs: { src: '/attachments/download/1/screenshot (1).png', alt: 'a' } }),
    );
    // No raw space/paren survives inside the (...) — the url is one unbroken token.
    expect(md).toBe('![a](/attachments/download/1/screenshot%20%281%29.png)\n');
  });

  it('table → markdown pipe table (first row is header)', () => {
    const cell = (text: string): PMNode => ({ type: 'tableCell', content: [p(t(text))] });
    const row = (...cells: string[]): PMNode => ({ type: 'tableRow', content: cells.map(cell) });
    const md = proseMirrorToMarkdown(doc({ type: 'table', content: [row('A', 'B'), row('1', '2')] }));
    expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  });

  it('callout maps known kinds and falls back to info', () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: 'callout', attrs: { kind: 'warning' }, content: [p(t('важно'))] },
        { type: 'panel', attrs: { type: 'weird' }, content: [p(t('текст'))] },
      ),
    );
    expect(md).toBe(':::warning\nважно\n:::\n\n:::info\nтекст\n:::\n');
  });

  it('spoiler/details with title', () => {
    const md = proseMirrorToMarkdown(doc({ type: 'details', attrs: { title: 'Скрытое' }, content: [p(t('секрет'))] }));
    expect(md).toBe(':::details Скрытое\nсекрет\n:::\n');
  });

  it('accepts a JSON string and degrades unknown nodes by recursing content', () => {
    const json = JSON.stringify(doc({ type: 'mysteryBlock', content: [p(t('всё равно сохранён'))] }));
    expect(proseMirrorToMarkdown(json)).toBe('всё равно сохранён\n');
  });

  it('neutralizes structural tokens that come from text (no fabricated embed/callout)', () => {
    const embed = proseMirrorToMarkdown(doc(p(t('[[table:SECRET]]'))));
    expect(embed).not.toMatch(/^\[\[table:SECRET\]\]/m); // would render as a live embed
    expect(embed).toContain('table:SECRET'); // text preserved (with ZWSP)

    const callout = proseMirrorToMarkdown(doc(p(t(':::danger')), p(t('evil')), p(t(':::'))));
    expect(callout).not.toMatch(/^:::danger$/m);
    expect(callout).not.toMatch(/^:::$/m);

    const heading = proseMirrorToMarkdown(doc(p(t('# не заголовок'))));
    expect(heading).not.toMatch(/^# не заголовок/m);

    const fence = proseMirrorToMarkdown(doc(p(t('```js'))));
    expect(fence).not.toMatch(/^```js/m);
  });

  it('still emits REAL callout/heading/table structure (escaping is text-only)', () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('Реальный')] },
        { type: 'callout', attrs: { kind: 'info' }, content: [p(t('текст'))] },
      ),
    );
    expect(md).toMatch(/^# Реальный/m);
    expect(md).toMatch(/^:::info$/m);
  });

  it('round-trips a realistic mixed document without throwing', () => {
    const md = proseMirrorToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [t('Гайд')] },
        p(t('Вступление с '), t('акцентом', [{ type: 'bold' }]), t('.')),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('пункт'))] }] },
        { type: 'callout', attrs: { kind: 'tip' }, content: [p(t('совет'))] },
      ),
    );
    expect(md).toContain('# Гайд');
    expect(md).toContain('**акцентом**');
    expect(md).toContain('- пункт');
    expect(md).toContain(':::tip\nсовет\n:::');
  });
});
