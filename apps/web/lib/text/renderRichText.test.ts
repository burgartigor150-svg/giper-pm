import { describe, it, expect } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderRichText } from './renderRichText';

/** Render the ReactNode output to a static HTML string for assertions. */
function html(node: ReturnType<typeof renderRichText>): string {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

describe('renderRichText — markdown links', () => {
  it('renders an absolute markdown link as an anchor', () => {
    const out = html(renderRichText('см. [сайт](https://example.com) тут'));
    expect(out).toContain('<a');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('сайт');
  });

  it('strips a relative markdown link to its label (no raw markup, no anchor)', () => {
    // The exact shape an un-repaired Bitrix action-link leaves behind.
    const out = html(renderRichText('срок на [, ](/workgroups/group/930/tasks/)'));
    expect(out).not.toContain('<a');
    expect(out).not.toContain(']('); // no leaked markdown
    expect(out).not.toContain('/workgroups/');
  });

  it('still renders a bare absolute url as an anchor', () => {
    const out = html(renderRichText('join https://telemost.yandex.ru/j/123'));
    expect(out).toContain('href="https://telemost.yandex.ru/j/123"');
  });

  it('renders a clean deadline line with the recovered date as plain text', () => {
    const out = html(
      renderRichText('@Зобков Игорь установил крайний срок задачи на 31.07.2026, 19:00'),
    );
    expect(out).toContain('31.07.2026, 19:00');
    expect(out).not.toContain('<a');
  });
});
