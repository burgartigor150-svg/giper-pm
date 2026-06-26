'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { setWorkflowColumnTransitionsAction } from '@/actions/workflow';

type Column = { id: string; name: string; status: string };

type Props = {
  projectKey: string;
  columns: Column[];
  initial: { fromColumnId: string; toColumnId: string }[];
  canManage: boolean;
};

const key = (from: string, to: string) => `${from}->${to}`;

/**
 * Per-COLUMN transition allowlist for free-form boards (rows = from, columns =
 * to). Only SAME-category column→column moves are governed here — cross-category
 * moves are gated by the status (category) workflow above, so those cells are
 * disabled. An empty matrix = no restriction (any same-category move allowed).
 * Moving into a «Отмена» (CANCELED) column and a self-move are always allowed.
 */
export function WorkflowColumnGraphEditor({ projectKey, columns, initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edges, setEdges] = useState<Set<string>>(
    () => new Set(initial.map((e) => key(e.fromColumnId, e.toColumnId))),
  );
  const [msg, setMsg] = useState<string | null>(null);

  function toggle(from: string, to: string) {
    if (!canManage) return;
    setEdges((cur) => {
      const next = new Set(cur);
      const k = key(from, to);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function save() {
    setMsg(null);
    const list = [...edges].map((k) => {
      const [from, to] = k.split('->');
      return { from: from!, to: to! };
    });
    startTransition(async () => {
      const res = await setWorkflowColumnTransitionsAction(projectKey, list);
      if (res.ok) {
        setMsg(edges.size === 0 ? 'Сохранено — без ограничений' : 'Сохранено');
        router.refresh();
      } else setMsg(res.error.message);
    });
  }

  if (columns.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Создайте колонки на доске, чтобы настроить переходы между ними.
      </p>
    );
  }

  const active = edges.size > 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Разрешённые переходы между колонками одной категории (строка → столбец). Пустая матрица =
        без ограничений. Переходы между разными категориями задаются матрицей статусов выше;
        переход в колонку категории «Отмена» разрешён всегда.
      </p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1 text-left text-muted-foreground">из ↓ / в →</th>
              {columns.map((c) => (
                <th key={c.id} className="p-1 font-medium text-muted-foreground">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {columns.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap p-1 font-medium text-muted-foreground">{r.name}</td>
                {columns.map((c) => {
                  const self = r.id === c.id;
                  const crossCategory = r.status !== c.status;
                  const toCanceled = c.status === 'CANCELED';
                  const disabled = self || crossCategory || toCanceled;
                  const on = edges.has(key(r.id, c.id));
                  return (
                    <td key={c.id} className="p-1 text-center">
                      {disabled ? (
                        <span
                          className="text-muted-foreground/40"
                          title={
                            self
                              ? 'тот же столбец'
                              : crossCategory
                                ? 'другая категория — задаётся матрицей статусов'
                                : 'переход в «Отмена» разрешён всегда'
                          }
                        >
                          —
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canManage || pending}
                          onChange={() => toggle(r.id, c.id)}
                          className="h-4 w-4 cursor-pointer rounded border-input"
                          aria-label={`${r.name} → ${c.name}`}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage ? (
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={pending}>
            Сохранить
          </Button>
          {active ? (
            <button
              type="button"
              onClick={() => setEdges(new Set())}
              disabled={pending}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Снять все (без ограничений)
            </button>
          ) : null}
          {msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
