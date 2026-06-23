// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { KbCallout, KbSpoiler, KbTableEmbedNode } from '@/components/domain/knowledge/tiptap/kbBlocks';

/**
 * Round-trip guard for the KB custom blocks: markdown → TipTap doc → markdown
 * must preserve our :::callout / :::details / [[table:ID]] syntax exactly, so
 * editing+saving an existing article never corrupts them (the bug that gated the
 * WYSIWYG editor behind a markdown fallback).
 */
function roundtrip(md: string): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      KbCallout,
      KbSpoiler,
      KbTableEmbedNode,
      Markdown.configure({ html: false, transformPastedText: true, linkify: true }),
    ],
    content: md,
  });
  const out = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
  editor.destroy();
  return out;
}

describe('kb custom blocks round-trip', () => {
  it('preserves an info callout', () => {
    const out = roundtrip(':::info\nтекст инфоблока\n:::');
    expect(out).toContain(':::info');
    expect(out).toContain('текст инфоблока');
    expect(out.replace(/\s/g, '')).toContain(':::info'); // opener present
    expect(out.trimEnd().endsWith(':::')).toBe(true); // closed
  });

  it('preserves a callout title', () => {
    const out = roundtrip(':::warning Внимание\nтекст\n:::');
    expect(out).toContain(':::warning Внимание');
    expect(out).toContain('текст');
  });

  it('preserves a details spoiler with title', () => {
    const out = roundtrip(':::details Подробнее\nскрытый текст\n:::');
    expect(out).toContain(':::details Подробнее');
    expect(out).toContain('скрытый текст');
  });

  it('preserves a table embed token UNESCAPED (the corruption bug)', () => {
    const out = roundtrip('[[table:abc123]]');
    expect(out).toContain('[[table:abc123]]');
    expect(out).not.toContain('\\[');
  });

  it('preserves mixed content', () => {
    const md = '## Заголовок\n\nабзац\n\n:::info\nвнутри\n:::\n\n[[table:t1]]';
    const out = roundtrip(md);
    expect(out).toContain('## Заголовок');
    expect(out).toContain(':::info');
    expect(out).toContain('внутри');
    expect(out).toContain('[[table:t1]]');
    expect(out).not.toContain('\\[');
  });
});
