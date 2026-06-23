'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Markdown } from 'tiptap-markdown';
import {
  Bold, ChevronDown, Code, Database, Heading1, Heading2, Heading3, Image as ImageIcon, Info, Italic, Link2,
  List, ListChecks, ListOrdered, Minus, Quote, Redo2, Strikethrough, Table as TableIcon, TriangleAlert, Undo2,
} from 'lucide-react';
import { KbCallout, KbSpoiler, KbTableEmbedNode } from './tiptap/kbBlocks';

/**
 * Visual (WYSIWYG) article editor — TEAMLY/Notion-style. No raw markdown syntax
 * is shown; the user formats blocks visually. Content round-trips to markdown
 * (storage format unchanged) via tiptap-markdown, so the read view and existing
 * articles keep working.
 */
export function KbRichEditor({
  initialMarkdown,
  onChange,
  spaceTables = [],
}: {
  initialMarkdown: string;
  onChange: (markdown: string) => void;
  spaceTables?: { id: string; name: string }[];
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false, autolink: true, HTMLAttributes: { class: 'text-blue-600 underline dark:text-blue-400' } },
        codeBlock: { HTMLAttributes: { class: 'rounded-md bg-muted p-3 font-mono text-[0.85em]' } },
      }),
      Image.configure({ HTMLAttributes: { class: 'my-2 max-w-full rounded-md border border-neutral-200 dark:border-neutral-800' } }),
      Placeholder.configure({ placeholder: 'Начните писать или выберите блок на панели…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false, HTMLAttributes: { class: 'kb-rte-table' } }),
      TableRow,
      TableHeader,
      TableCell,
      KbCallout,
      KbSpoiler,
      KbTableEmbedNode,
      Markdown.configure({ html: false, transformPastedText: true, linkify: true }),
    ],
    content: initialMarkdown,
    editorProps: {
      attributes: {
        class:
          'kb-rte prose prose-sm max-w-none min-h-[420px] rounded-md border border-neutral-300 p-4 text-sm outline-none focus:border-neutral-500 dark:prose-invert dark:border-neutral-700 dark:bg-neutral-900',
      },
    },
    onUpdate: ({ editor }) => {
      const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      // Defensive: if a [[table:ID]] token ever slips into the visual editor, the
      // markdown serializer escapes the brackets — un-escape so the embed survives.
      onChange(md.replace(/\\\[\\\[table:([A-Za-z0-9_-]+)\\\]\\\]/g, '[[table:$1]]'));
    },
  });

  if (!editor) return <div className="min-h-[420px] rounded-md border border-neutral-300 p-4 text-sm text-muted-foreground dark:border-neutral-700">Загрузка редактора…</div>;

  return (
    <div className="flex flex-col gap-2">
      <Toolbar editor={editor} spaceTables={spaceTables} />
      <EditorContent editor={editor} />
      <style>{`
        .kb-rte ul[data-type="taskList"]{list-style:none;padding-left:0}
        .kb-rte ul[data-type="taskList"] li{display:flex;gap:.5rem;align-items:flex-start}
        .kb-rte ul[data-type="taskList"] li>label{margin-top:.15rem}
        .kb-rte-table{border-collapse:collapse;width:100%}
        .kb-rte-table td,.kb-rte-table th{border:1px solid #d4d4d4;padding:.35rem .5rem;min-width:3rem}
        .dark .kb-rte-table td,.dark .kb-rte-table th{border-color:#404040}
        .kb-rte-table th{background:rgba(0,0,0,.04);font-weight:600}
        .kb-rte p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#9ca3af;float:left;height:0;pointer-events:none}
        .kb-rte .kb-callout{border-left:4px solid;border-radius:.375rem;padding:.6rem .75rem;margin:.6rem 0}
        .kb-rte .kb-callout-info{border-color:#60a5fa;background:rgba(59,130,246,.08)}
        .kb-rte .kb-callout-success{border-color:#34d399;background:rgba(16,185,129,.08)}
        .kb-rte .kb-callout-warning{border-color:#fbbf24;background:rgba(245,158,11,.08)}
        .kb-rte .kb-callout-danger{border-color:#f87171;background:rgba(239,68,68,.08)}
        .kb-rte .kb-callout[data-title]::before{content:attr(data-title);display:block;font-weight:600;margin-bottom:.25rem}
        .kb-rte .kb-spoiler{border:1px solid #d4d4d4;border-radius:.375rem;padding:.6rem .75rem;margin:.6rem 0}
        .dark .kb-rte .kb-spoiler{border-color:#404040}
        .kb-rte .kb-spoiler::before{content:"▸ " attr(data-summary);display:block;font-weight:600;margin-bottom:.25rem;color:#6b7280}
        .kb-rte .kb-embed-chip{display:inline-flex;align-items:center;gap:.35rem;border:1px dashed #a3a3a3;border-radius:.375rem;padding:.3rem .6rem;margin:.4rem 0;color:#6b7280;font-size:.85em;user-select:none}
      `}</style>
    </div>
  );
}

function Toolbar({ editor, spaceTables }: { editor: Editor; spaceTables: { id: string; name: string }[] }) {
  const Btn = ({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted ${active ? 'bg-muted text-foreground' : ''}`}
    >
      {children}
    </button>
  );

  const sep = <span className="mx-0.5 h-5 w-px self-center bg-neutral-200 dark:bg-neutral-700" />;

  function addLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = prompt('Ссылка (URL)', prev ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }
  function addImage() {
    const url = prompt('URL изображения', 'https://');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }
  function addCallout(kind: string) {
    editor.chain().focus().insertContent({ type: 'kbCallout', attrs: { kind }, content: [{ type: 'paragraph' }] }).run();
  }
  function addSpoiler() {
    const title = prompt('Заголовок спойлера', 'Подробнее') ?? 'Подробнее';
    editor.chain().focus().insertContent({ type: 'kbSpoiler', attrs: { title }, content: [{ type: 'paragraph' }] }).run();
  }
  function addTableEmbed(id: string) {
    if (id) editor.chain().focus().insertContent({ type: 'kbTableEmbed', attrs: { tableId: id } }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-neutral-200 p-1 dark:border-neutral-800">
      <Btn on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} label="Заголовок 1"><Heading1 className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} label="Заголовок 2"><Heading2 className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} label="Заголовок 3"><Heading3 className="h-4 w-4" /></Btn>
      {sep}
      <Btn on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} label="Жирный"><Bold className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} label="Курсив"><Italic className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} label="Зачёркнутый"><Strikethrough className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} label="Моноширинный"><Code className="h-4 w-4" /></Btn>
      <Btn on={addLink} active={editor.isActive('link')} label="Ссылка"><Link2 className="h-4 w-4" /></Btn>
      {sep}
      <Btn on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} label="Маркированный список"><List className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} label="Нумерованный список"><ListOrdered className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} label="Чек-лист"><ListChecks className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} label="Цитата"><Quote className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} label="Блок кода"><Code className="h-4 w-4" /></Btn>
      {sep}
      <Btn on={addImage} label="Изображение"><ImageIcon className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Таблица"><TableIcon className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().setHorizontalRule().run()} label="Разделитель"><Minus className="h-4 w-4" /></Btn>
      {sep}
      <Btn on={() => addCallout('info')} label="Инфоблок"><Info className="h-4 w-4" /></Btn>
      <Btn on={() => addCallout('warning')} label="Предупреждение"><TriangleAlert className="h-4 w-4" /></Btn>
      <Btn on={addSpoiler} label="Спойлер"><ChevronDown className="h-4 w-4" /></Btn>
      {spaceTables.length > 0 ? (
        <div className="relative inline-flex">
          <select
            value=""
            onChange={(e) => { addTableEmbed(e.target.value); e.target.value = ''; }}
            aria-label="Встроить таблицу"
            className="h-7 rounded border border-neutral-300 pl-6 pr-1 text-xs dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Таблица…</option>
            {spaceTables.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <Database className="pointer-events-none absolute left-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
      ) : null}
      {sep}
      <Btn on={() => editor.chain().focus().undo().run()} label="Отменить"><Undo2 className="h-4 w-4" /></Btn>
      <Btn on={() => editor.chain().focus().redo().run()} label="Повторить"><Redo2 className="h-4 w-4" /></Btn>
    </div>
  );
}
