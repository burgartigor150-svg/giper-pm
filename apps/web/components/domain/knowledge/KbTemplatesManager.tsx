'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Plus, Trash2 } from 'lucide-react';
import {
  createTemplateAction,
  updateTemplateAction,
  deleteTemplateAction,
} from '@/actions/knowledge';
import { renderMarkdown } from '@/lib/knowledge/renderMarkdown';
import { KbEmojiPicker } from './KbEmojiPicker';

type Scope = 'ACCOUNT' | 'SPACE';
type Template = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  scope: Scope;
  spaceId: string | null;
  content: string;
  space: { id: string; name: string; icon: string | null } | null;
};
type Space = { id: string; name: string; icon: string | null };

const BLANK = {
  name: 'Новый шаблон',
  description: '',
  icon: null as string | null,
  scope: 'ACCOUNT' as Scope,
  spaceId: null as string | null,
  content: '',
};

/**
 * Templates admin: list of account + space article templates on the left, an
 * editor (name, icon, scope, body) on the right. ADMIN/PM only (gated upstream).
 */
export function KbTemplatesManager({ templates, spaces }: { templates: Template[]; spaces: Space[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(BLANK);
  const [preview, setPreview] = useState(false);

  const account = useMemo(() => templates.filter((t) => t.scope === 'ACCOUNT'), [templates]);
  const spaceScoped = useMemo(() => templates.filter((t) => t.scope === 'SPACE'), [templates]);

  function selectNew() {
    setSelectedId('new');
    setForm(BLANK);
    setPreview(false);
  }

  function selectTemplate(t: Template) {
    setSelectedId(t.id);
    setForm({
      name: t.name,
      description: t.description ?? '',
      icon: t.icon,
      scope: t.scope,
      spaceId: t.spaceId,
      content: t.content,
    });
    setPreview(false);
  }

  function save() {
    startTransition(async () => {
      if (selectedId === 'new') {
        const res = await createTemplateAction({
          name: form.name,
          scope: form.scope,
          spaceId: form.spaceId,
          content: form.content,
          description: form.description,
          icon: form.icon,
        });
        if (res.ok && res.data) {
          setSelectedId(res.data.id);
          router.refresh();
        } else if (!res.ok) alert(res.error.message);
      } else if (selectedId) {
        const res = await updateTemplateAction(selectedId, {
          name: form.name,
          content: form.content,
          description: form.description,
          icon: form.icon,
        });
        if (res.ok) router.refresh();
        else alert(res.error.message);
      }
    });
  }

  function remove() {
    if (selectedId === 'new' || !selectedId) return;
    if (!confirm('Удалить шаблон?')) return;
    startTransition(async () => {
      const res = await deleteTemplateAction(selectedId);
      if (res.ok) {
        setSelectedId(null);
        router.refresh();
      } else alert(res.error.message);
    });
  }

  return (
    <div className="flex min-h-[60vh] gap-6">
      {/* list */}
      <div className="w-64 shrink-0 border-r border-neutral-200 pr-3 dark:border-neutral-800">
        <button
          type="button"
          onClick={selectNew}
          className="mb-3 flex w-full items-center justify-center gap-1 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900"
        >
          <Plus className="h-3.5 w-3.5" /> Новый шаблон
        </button>
        <TemplateGroup title="Общие" items={account} selectedId={selectedId} onSelect={selectTemplate} />
        <TemplateGroup title="Пространств" items={spaceScoped} selectedId={selectedId} onSelect={selectTemplate} />
        {templates.length === 0 ? (
          <p className="px-1 py-4 text-xs text-muted-foreground">Шаблонов пока нет.</p>
        ) : null}
      </div>

      {/* editor */}
      <div className="min-w-0 flex-1">
        {selectedId === null ? (
          <p className="pt-10 text-center text-sm text-muted-foreground">
            Выберите шаблон слева или создайте новый.
          </p>
        ) : (
          <div className="flex max-w-3xl flex-col gap-4">
            <div className="flex items-start gap-3">
              <KbEmojiPicker
                value={form.icon}
                onSelect={(icon) => setForm((f) => ({ ...f, icon }))}
                disabled={pending}
                size="lg"
              />
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Название шаблона"
                className="min-w-0 flex-1 border-0 bg-transparent pt-1 text-xl font-bold outline-none"
              />
            </div>

            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Краткое описание (необязательно)"
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />

            {selectedId === 'new' ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={form.scope === 'ACCOUNT'}
                    onChange={() => setForm((f) => ({ ...f, scope: 'ACCOUNT', spaceId: null }))}
                  />
                  Общий (все пространства)
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    checked={form.scope === 'SPACE'}
                    onChange={() => setForm((f) => ({ ...f, scope: 'SPACE' }))}
                  />
                  Для пространства
                </label>
                {form.scope === 'SPACE' ? (
                  <select
                    value={form.spaceId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, spaceId: e.target.value || null }))}
                    className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="">— выберите —</option>
                    {spaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs dark:border-neutral-700"
              >
                {preview ? 'Редактор' : 'Просмотр'}
              </button>
            </div>

            {preview ? (
              <article className="min-h-[300px] max-w-none break-words rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
                {form.content.trim() ? renderMarkdown(form.content) : <p className="text-muted-foreground">Пусто.</p>}
              </article>
            ) : (
              <textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Тело шаблона в Markdown…"
                className="min-h-[300px] w-full resize-y rounded-md border border-neutral-300 p-3 font-mono text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
              />
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              >
                {pending ? 'Сохранение…' : selectedId === 'new' ? 'Создать' : 'Сохранить'}
              </button>
              {selectedId !== 'new' ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Удалить
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateGroup({
  title,
  items,
  selectedId,
  onSelect,
}: {
  title: string;
  items: Template[];
  selectedId: string | 'new' | null;
  onSelect: (t: Template) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul>
        {items.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => onSelect(t)}
              className={`flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                selectedId === t.id ? 'bg-muted font-medium' : ''
              }`}
            >
              <span className="shrink-0">{t.icon ?? <FileText className="h-3.5 w-3.5 text-muted-foreground" />}</span>
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.scope === 'SPACE' && t.space ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{t.space.icon ?? '📚'}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
