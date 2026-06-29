'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { setWorkflowTransitionsAction } from '@/actions/workflow';

const STATUSES = [
  { value: 'BACKLOG', label: 'Бэклог' },
  { value: 'TODO', label: 'К работе' },
  { value: 'IN_PROGRESS', label: 'В работе' },
  { value: 'TESTING', label: 'Тест' },
  { value: 'REVIEW', label: 'Ревью' },
  { value: 'BLOCKED', label: 'Блок' },
  { value: 'DONE', label: 'Готово' },
  { value: 'CANCELED', label: 'Отмена' },
] as const;

type Props = {
  projectKey: string;
  initial: { fromStatus: string; toStatus: string }[];
  canManage: boolean;
};

const key = (from: string, to: string) => `${from}->${to}`;

/**
 * From→to transition allowlist editor (rows = from, columns = to). An empty
 * matrix means "no workflow" → any move allowed (inert). Self-moves and any
 * →CANCELED are always allowed by the engine, so the diagonal + the CANCELED
 * column are not editable here.
 */
export function WorkflowMatrixEditor({ projectKey, initial, canManage }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [edges, setEdges] = useState<Set<string>>(
    () => new Set(initial.map((e) => key(e.fromStatus, e.toStatus))),
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
      const res = await setWorkflowTransitionsAction(projectKey, list);
      if (res.ok) {
        setMsg(edges.size === 0 ? 'Сохранено — переходы без ограничений' : 'Сохранено');
        router.refresh();
      } else setMsg(res.error.message);
    });
  }

  function clearAll() {
    setEdges(new Set());
  }

  const active = edges.size > 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Отметьте разрешённые переходы статусов (строка → столбец). Пустая матрица = без
        ограничений (любой переход разрешён). Переход в «Отмена» и в тот же статус разрешены всегда.
      </p>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="p-1 text-left text-muted-foreground">из ↓ / в →</th>
              {STATUSES.map((c) => (
                <th key={c.value} className="p-1 font-medium text-muted-foreground">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATUSES.map((r) => (
              <tr key={r.value}>
                <td className="whitespace-nowrap p-1 font-medium text-muted-foreground">{r.label}</td>
                {STATUSES.map((c) => {
                  const disabled = r.value === c.value || c.value === 'CANCELED';
                  const on = edges.has(key(r.value, c.value));
                  return (
                    <td key={c.value} className="p-1 text-center">
                      {disabled ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!canManage || pending}
                          onChange={() => toggle(r.value, c.value)}
                          className="h-4 w-4 cursor-pointer rounded border-input"
                          aria-label={`${r.label} → ${c.label}`}
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
          <Button onClick={save} disabled={pending}>Сохранить</Button>
          {active ? (
            <button
              type="button"
              onClick={clearAll}
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
