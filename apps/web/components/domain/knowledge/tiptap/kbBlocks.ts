import { Node, mergeAttributes } from '@tiptap/core';
import MarkdownItContainer from 'markdown-it-container';

// markdown-it is a transitive dep (via tiptap-markdown); type loosely as `any`
// to avoid a hard dependency on its type package.
type MarkdownIt = any;

/**
 * Custom TipTap nodes for the KB's signature blocks, with lossless markdown
 * round-trip (tiptap-markdown parses markdown-it → HTML → ProseMirror, and we
 * serialize back to the same `:::`/`[[table:ID]]` markdown the read renderer
 * (lib/knowledge/renderMarkdown) understands). Visual styling is via renderHTML
 * classes — the callout/spoiler are editable styled boxes, no raw syntax shown.
 */

const CALLOUT_KINDS = ['info', 'warning', 'success', 'tip', 'danger', 'note'] as const;

function calloutClass(kind: string): string {
  switch (kind) {
    case 'tip':
    case 'success':
      return 'kb-callout kb-callout-success';
    case 'warning':
    case 'warn':
      return 'kb-callout kb-callout-warning';
    case 'danger':
      return 'kb-callout kb-callout-danger';
    default:
      return 'kb-callout kb-callout-info';
  }
}

export const KbCallout = Node.create({
  name: 'kbCallout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: 'info',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-kind') || 'info',
        renderHTML: (attrs) => ({ 'data-kind': attrs.kind }),
      },
      title: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || '',
        renderHTML: (attrs) => (attrs.title ? { 'data-title': attrs.title } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': '', class: calloutClass(node.attrs.kind) }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const title = node.attrs.title ? ` ${node.attrs.title}` : '';
          state.write(`:::${node.attrs.kind}${title}\n`);
          state.renderContent(node);
          state.ensureNewLine();
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            for (const kind of CALLOUT_KINDS) {
              markdownit.use(MarkdownItContainer, kind, {
                render(tokens: any[], idx: number) {
                  const token = tokens[idx];
                  if (token.nesting === 1) {
                    const info = (token.info || '').trim();
                    const title = info.slice(kind.length).trim();
                    const t = title ? ` data-title="${markdownit.utils.escapeHtml(title)}"` : '';
                    return `<div data-callout data-kind="${kind}"${t}>`;
                  }
                  return '</div>\n';
                },
              });
            }
          },
        },
      },
    };
  },
});

export const KbSpoiler = Node.create({
  name: 'kbSpoiler',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      title: {
        default: 'Подробнее',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-title') || 'Подробнее',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-spoiler]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'kb-spoiler', 'data-summary': node.attrs.title }),
      0,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const title = node.attrs.title ? ` ${node.attrs.title}` : '';
          state.write(`:::details${title}\n`);
          state.renderContent(node);
          state.ensureNewLine();
          state.write(':::');
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(MarkdownItContainer, 'details', {
              render(tokens: any[], idx: number) {
                const token = tokens[idx];
                if (token.nesting === 1) {
                  const info = (token.info || '').trim();
                  const title = info.slice('details'.length).trim() || 'Подробнее';
                  return `<div data-spoiler data-title="${markdownit.utils.escapeHtml(title)}">`;
                }
                return '</div>\n';
              },
            });
          },
        },
      },
    };
  },
});

export const KbTableEmbedNode = Node.create({
  name: 'kbTableEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tableId: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-table-id') || '',
        renderHTML: (attrs) => ({ 'data-table-id': attrs.tableId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-table-embed]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-table-embed': '', class: 'kb-embed-chip', contenteditable: 'false' }),
      `📊 Таблица ${node.attrs.tableId}`,
    ];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`[[table:${node.attrs.tableId}]]`);
          state.closeBlock(node);
        },
        parse: {
          setup(markdownit: MarkdownIt) {
            // Block rule: a line that is exactly [[table:ID]] → an embed div.
            markdownit.block.ruler.before('paragraph', 'kb_table_embed', (stateBlock: any, startLine: number, _endLine: number, silent: boolean) => {
              const start = stateBlock.bMarks[startLine] + stateBlock.tShift[startLine];
              const max = stateBlock.eMarks[startLine];
              const line = stateBlock.src.slice(start, max).trim();
              const m = /^\[\[table:([A-Za-z0-9_-]+)\]\]$/.exec(line);
              if (!m) return false;
              if (silent) return true;
              const token = stateBlock.push('kb_table_embed', 'div', 0);
              token.map = [startLine, startLine + 1];
              token.meta = { id: m[1] };
              stateBlock.line = startLine + 1;
              return true;
            });
            markdownit.renderer.rules.kb_table_embed = (tokens: any[], idx: number) =>
              `<div data-table-embed data-table-id="${markdownit.utils.escapeHtml(tokens[idx].meta.id)}"></div>`;
          },
        },
      },
    };
  },
});
