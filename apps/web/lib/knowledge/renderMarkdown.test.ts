import { describe, expect, test } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown, extractHeadings, slugifyBase, extractTableIds } from './renderMarkdown';

/** Render the markdown node tree to a static HTML string for assertions. */
function html(md: string): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(md)));
}

describe('renderMarkdown', () => {
  test('returns null for empty / whitespace input', () => {
    expect(renderMarkdown('')).toBeNull();
    expect(renderMarkdown('   \n  ')).toBeNull();
    expect(renderMarkdown(null)).toBeNull();
  });

  test('renders headings at the right level', () => {
    expect(html('# Title')).toContain('<h1');
    expect(html('### Sub')).toContain('<h3');
    expect(html('# Title')).toContain('Title');
  });

  test('renders bold, italic and inline code', () => {
    const out = html('a **bold** and *italic* and `code` end');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<code');
    expect(out).toContain('code</code>');
  });

  test('renders markdown links and bare urls safely', () => {
    const link = html('see [docs](https://example.com/x)');
    expect(link).toContain('href="https://example.com/x"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain('>docs</a>');
    expect(html('go https://foo.bar now')).toContain('href="https://foo.bar"');
  });

  test('renders unordered and ordered lists', () => {
    const ul = html('- one\n- two');
    expect(ul).toContain('<ul');
    expect((ul.match(/<li/g) ?? []).length).toBe(2);
    const ol = html('1. first\n2. second');
    expect(ol).toContain('<ol');
  });

  test('renders task list with checkboxes', () => {
    const out = html('- [ ] todo\n- [x] done');
    expect((out.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(out).toContain('checked');
    expect(out).toContain('line-through'); // the done item is struck through
  });

  test('renders a table', () => {
    const out = html('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(out).toContain('<table');
    expect((out.match(/<th[\s>]/g) ?? []).length).toBe(2);
    expect((out.match(/<td[\s>]/g) ?? []).length).toBe(2);
    expect(out).toContain('>1</td>');
  });

  test('renders blockquotes and fenced code blocks', () => {
    expect(html('> quoted')).toContain('<blockquote');
    const code = html('```\nconst x = 1;\n```');
    expect(code).toContain('<pre');
    expect(code).toContain('const x = 1;');
  });

  test('renders a horizontal rule', () => {
    expect(html('---')).toContain('<hr');
  });

  test('groups consecutive lines into a single paragraph', () => {
    const out = html('line one\nline two\n\nsecond para');
    expect((out.match(/<p/g) ?? []).length).toBe(2);
  });

  test('escapes html in plain text (no raw injection)', () => {
    const out = html('hello <script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  test('sanitizes unsafe link schemes (javascript:/data:) to #', () => {
    const js = html('[x](javascript:alert(1))');
    expect(js).not.toContain('javascript:');
    expect(js).toContain('href="#"');
    const data = html('[y](data:text/html;base64,PHN2Zz4=)');
    expect(data).not.toContain('data:text/html');
    expect(data).toContain('href="#"');
    // legitimate schemes survive
    expect(html('[z](https://example.com)')).toContain('href="https://example.com"');
    expect(html('[m](mailto:a@b.co)')).toContain('href="mailto:a@b.co"');
  });

  test('renders heading anchor ids that match slugs', () => {
    const out = html('## Привет Мир');
    const slug = slugifyBase('Привет Мир');
    expect(slug).toBe('привет-мир');
    expect(out).toContain(`id="${slug}"`);
  });
});

describe('table embeds', () => {
  test('extractTableIds finds [[table:ID]] tokens, dedups, skips fences', () => {
    expect(extractTableIds('text\n[[table:abc123]]\nmore\n[[table:abc123]]')).toEqual(['abc123']);
    expect(extractTableIds('[[table:a1]]\n[[table:b2]]')).toEqual(['a1', 'b2']);
    expect(extractTableIds('```\n[[table:nope]]\n```')).toEqual([]);
    expect(extractTableIds('no tokens here')).toEqual([]);
  });

  test('renders provided embed node for a token, else a placeholder', () => {
    const withEmbed = renderToStaticMarkup(
      createElement(Fragment, null, renderMarkdown('[[table:t1]]', { tableEmbeds: { t1: createElement('div', null, 'EMBED-OK') } })),
    );
    expect(withEmbed).toContain('EMBED-OK');

    const withoutEmbed = renderToStaticMarkup(createElement(Fragment, null, renderMarkdown('[[table:t1]]')));
    expect(withoutEmbed).toContain('отобразится в статье');
  });
});

describe('extractHeadings', () => {
  test('returns level, text and slug in document order', () => {
    const hs = extractHeadings('# A\nsome text\n## B\n### C');
    expect(hs.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(hs.map((h) => h.text)).toEqual(['A', 'B', 'C']);
    expect(hs[0]?.slug).toBe('a');
  });

  test('disambiguates duplicate headings', () => {
    const hs = extractHeadings('# Раздел\n# Раздел');
    expect(hs[0]?.slug).toBe('раздел');
    expect(hs[1]?.slug).toBe('раздел-2');
  });

  test('skips headings inside fenced code blocks', () => {
    const hs = extractHeadings('# Real\n```\n# not a heading\n```\n## Also real');
    expect(hs.map((h) => h.text)).toEqual(['Real', 'Also real']);
  });

  test('returns empty for empty input', () => {
    expect(extractHeadings('')).toEqual([]);
    expect(extractHeadings(null)).toEqual([]);
  });
});
