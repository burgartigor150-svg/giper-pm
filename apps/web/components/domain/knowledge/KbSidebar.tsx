'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronDown, ChevronRight, FileText, Plus } from 'lucide-react';
import { createArticleAction, createSpaceAction } from '@/actions/knowledge';

type Space = { id: string; name: string; icon: string | null };
type Node = { id: string; title: string; icon: string | null; parentId: string | null; order: number; spaceId: string };

/**
 * Knowledge Base navigation: spaces, each with a nested, expandable article
 * tree. Editors get inline "+ article" / "+ space" actions. Persistent across
 * article navigation (rendered in the KB layout). Active article is derived
 * from the URL so the layout doesn't have to thread the child route param.
 */
export function KbSidebar({
  spaces,
  articles,
  canManageSpaces,
  canEdit,
}: {
  spaces: Space[];
  articles: Node[];
  canManageSpaces: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname?.startsWith('/knowledge/') ? pathname.slice('/knowledge/'.length).split('/')[0] : null;
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // children map: parentKey ("space:<id>" or "art:<id>") → ordered nodes
  const childrenOf = useMemo(() => {
    const map = new Map<string, Node[]>();
    for (const a of articles) {
      const key = a.parentId ? `art:${a.parentId}` : `space:${a.spaceId}`;
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((x, y) => x.order - y.order);
    return map;
  }, [articles]);

  const toggle = (k: string) => setCollapsed((s) => ({ ...s, [k]: !s[k] }));

  function newArticle(spaceId: string, parentId: string | null) {
    startTransition(async () => {
      const res = await createArticleAction(spaceId, parentId);
      if (res.ok && res.data) router.push(`/knowledge/${res.data.id}`);
      else if (!res.ok) alert(res.error.message);
    });
  }

  function newSpace() {
    const name = prompt('Название пространства');
    if (!name) return;
    startTransition(async () => {
      const res = await createSpaceAction(name);
      if (res.ok) router.refresh();
      else alert(res.error.message);
    });
  }

  function renderNodes(key: string, depth: number) {
    const nodes = childrenOf.get(key);
    if (!nodes || nodes.length === 0) return null;
    return (
      <ul>
        {nodes.map((n) => {
          const ck = `art:${n.id}`;
          const kids = childrenOf.get(ck);
          const open = !collapsed[ck];
          return (
            <li key={n.id}>
              <div
                className={`group flex items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-muted ${
                  activeId === n.id ? 'bg-muted font-medium' : ''
                }`}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
              >
                {kids && kids.length > 0 ? (
                  <button type="button" onClick={() => toggle(ck)} className="text-muted-foreground" aria-label={open ? 'Свернуть' : 'Развернуть'}>
                    {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="inline-block w-3.5" />
                )}
                <Link href={`/knowledge/${n.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 truncate">
                  <span className="shrink-0">{n.icon ?? <FileText className="h-3.5 w-3.5 text-muted-foreground" />}</span>
                  <span className="truncate">{n.title}</span>
                </Link>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => newArticle(n.spaceId, n.id)}
                    disabled={pending}
                    className="opacity-0 transition group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                    aria-label="Подстатья"
                    title="Добавить подстатью"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              {kids && kids.length > 0 && open ? renderNodes(ck, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav className="flex h-full flex-col gap-1 overflow-y-auto p-2 text-sm">
      <Link
        href="/knowledge"
        className={`mb-1 rounded px-2 py-1 font-semibold ${activeId === null ? 'bg-muted' : 'hover:bg-muted'}`}
      >
        База знаний
      </Link>
      {spaces.length === 0 ? (
        <p className="px-2 py-4 text-xs text-muted-foreground">Пространств пока нет.</p>
      ) : null}
      {spaces.map((sp) => {
        const sk = `space:${sp.id}`;
        const open = !collapsed[sk];
        return (
          <div key={sp.id} className="mt-1">
            <div className="group flex items-center gap-1 rounded px-1.5 py-1">
              <button type="button" onClick={() => toggle(sk)} className="text-muted-foreground" aria-label={open ? 'Свернуть' : 'Развернуть'}>
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              <span className="shrink-0">{sp.icon ?? '📚'}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {sp.name}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => newArticle(sp.id, null)}
                  disabled={pending}
                  className="opacity-0 transition group-hover:opacity-100 text-muted-foreground hover:text-foreground"
                  aria-label="Статья"
                  title="Добавить статью"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {open ? renderNodes(sk, 1) : null}
          </div>
        );
      })}
      {canManageSpaces ? (
        <button
          type="button"
          onClick={newSpace}
          disabled={pending}
          className="mt-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Новое пространство
        </button>
      ) : null}
    </nav>
  );
}
