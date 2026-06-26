'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  updateAutomationsAction,
  type AutomationRuleInput,
  type AutomationActionKind,
} from '@/actions/automations';
import type { AutomationView } from '@/lib/board/getAutomations';

const ACTION_LABELS: Record<AutomationActionKind, string> = {
  SET_ASSIGNEE: 'Назначить исполнителя',
  SET_PRIORITY: 'Поставить приоритет',
  SET_SWIMLANE: 'Переместить в дорожку',
};
const ACTION_KINDS = Object.keys(ACTION_LABELS) as AutomationActionKind[];
const PRIORITIES: Array<{ value: string; label: string }> = [
  { value: 'LOW', label: 'Низкий' },
  { value: 'MEDIUM', label: 'Средний' },
  { value: 'HIGH', label: 'Высокий' },
  { value: 'URGENT', label: 'Срочный' },
];

type Row = {
  id: string | null;
  name: string;
  enabled: boolean;
  triggerType: 'CARD_ENTERS_COLUMN' | 'TASK_CREATED';
  triggerStatus: string;
  /** Non-empty = column-keyed trigger (fires only on that exact board column). */
  triggerColumnId: string;
  actionType: AutomationActionKind;
  actionValue: string;
};

type Props = {
  projectId: string;
  initial: AutomationView[];
  /** Board columns for the trigger picker. Synthesized defaults have `default-*` ids. */
  columns: { id: string; status: string; name: string }[];
  /** Whether free-form columns are on — gates the per-column trigger mode. */
  freeFormEnabled: boolean;
  /** Swimlanes for the SET_SWIMLANE action. */
  swimlanes: { id: string; name: string }[];
  /** Project members for the SET_ASSIGNEE action. */
  members: { id: string; name: string }[];
};

/**
 * Manage a project's automation rules: "when a card enters column X → do Y".
 * Reconciles the full set on save.
 */
export function AutomationsForm({ projectId, initial, columns, freeFormEnabled, swimlanes, members }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Category options: one entry per distinct status (back-compat with the
  // status-keyed picker; in 1:1 mode this is just the default columns).
  const categoryOptions = (() => {
    const seen = new Set<string>();
    const out: { status: string; name: string }[] = [];
    for (const c of columns) {
      if (seen.has(c.status)) continue;
      seen.add(c.status);
      out.push({ status: c.status, name: c.name });
    }
    return out;
  })();
  const firstStatus = categoryOptions[0]?.status ?? 'DONE';
  // Real (materialized) columns — the only valid targets for a per-column rule.
  const realColumns = columns.filter((c) => !c.id.startsWith('default-'));
  const canUseColumnMode = freeFormEnabled && realColumns.length > 0;
  const [rows, setRows] = useState<Row[]>(() =>
    [...initial].map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      triggerType: r.triggerType === 'TASK_CREATED' ? 'TASK_CREATED' : 'CARD_ENTERS_COLUMN',
      triggerStatus: r.triggerStatus || firstStatus,
      triggerColumnId: r.triggerColumnId || '',
      actionType: (ACTION_KINDS as string[]).includes(r.actionType)
        ? (r.actionType as AutomationActionKind)
        : 'SET_PRIORITY',
      actionValue: r.actionValue,
    })),
  );

  function patch(i: number, p: Partial<Row>) {
    setRows((cur) => cur.map((r, k) => (k === i ? { ...r, ...p } : r)));
  }

  function save() {
    setSaved(false);
    setError(null);
    if (rows.some((r) => r.name.trim().length === 0)) {
      setError('У каждого правила должно быть название');
      return;
    }
    // A column-keyed rule whose column was deleted would be rejected server-side,
    // and because the save is an all-or-nothing reconcile it would block EVERY
    // edit (even to unrelated rules). Surface it here, before the round-trip, so
    // the user knows which rule to fix (switch its trigger back to «категорию»).
    if (
      rows.some(
        (r) =>
          r.triggerType === 'CARD_ENTERS_COLUMN' &&
          r.triggerColumnId &&
          !realColumns.some((c) => c.id === r.triggerColumnId),
      )
    ) {
      setError('Одно из правил ссылается на удалённую колонку — переключите его триггер на «категорию».');
      return;
    }
    startTransition(async () => {
      const payload: AutomationRuleInput[] = rows.map((r, i) => ({
        id: r.id,
        name: r.name.trim(),
        enabled: r.enabled,
        triggerType: r.triggerType,
        triggerStatus: r.triggerStatus,
        triggerColumnId: r.triggerType === 'CARD_ENTERS_COLUMN' ? r.triggerColumnId : '',
        actionType: r.actionType,
        actionValue: r.actionValue,
        order: i,
      }));
      const res = await updateAutomationsAction(projectId, payload);
      if (res.ok) {
        setSaved(true);
        router.refresh();
        setTimeout(() => setSaved(false), 1500);
      } else {
        setError(res.error.message);
      }
    });
  }

  function addRule() {
    setRows((cur) => [
      ...cur,
      {
        id: null,
        name: '',
        enabled: true,
        triggerType: 'CARD_ENTERS_COLUMN',
        triggerStatus: firstStatus,
        triggerColumnId: '',
        actionType: 'SET_PRIORITY',
        actionValue: 'HIGH',
      },
    ]);
  }

  const sel = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Правила «когда карточка попадает в колонку → выполнить действие».
        Выполняются автоматически при переходе задачи в колонку.
      </p>
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li
              key={r.id ?? `new-${i}`}
              className="flex flex-col gap-2 rounded-md border border-input bg-background p-3"
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => patch(i, { enabled: e.target.checked })}
                  disabled={pending}
                  title="Включено"
                  className="h-4 w-4"
                />
                <input
                  value={r.name}
                  onChange={(e) => patch(i, { name: e.target.value })}
                  disabled={pending}
                  maxLength={80}
                  placeholder="Название правила"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
                <button
                  type="button"
                  aria-label="Удалить правило"
                  onClick={() => setRows((cur) => cur.filter((_, k) => k !== i))}
                  disabled={pending}
                  className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>Когда</span>
                <select
                  value={r.triggerType}
                  onChange={(e) =>
                    patch(i, {
                      triggerType: e.target.value as 'CARD_ENTERS_COLUMN' | 'TASK_CREATED',
                    })
                  }
                  disabled={pending}
                  className={sel}
                >
                  <option value="CARD_ENTERS_COLUMN">карточка попадает в</option>
                  <option value="TASK_CREATED">создаётся задача</option>
                </select>
                {r.triggerType === 'CARD_ENTERS_COLUMN' ? (
                  <>
                    {canUseColumnMode || r.triggerColumnId ? (
                      <select
                        value={r.triggerColumnId ? 'column' : 'category'}
                        onChange={(e) =>
                          patch(
                            i,
                            e.target.value === 'column'
                              ? { triggerColumnId: realColumns[0]?.id ?? r.triggerColumnId }
                              : { triggerColumnId: '' },
                          )
                        }
                        disabled={pending}
                        className={sel}
                        aria-label="Тип триггера"
                      >
                        <option value="category">категорию</option>
                        <option value="column">колонку</option>
                      </select>
                    ) : null}
                    {r.triggerColumnId ? (
                      <select
                        value={r.triggerColumnId}
                        onChange={(e) => patch(i, { triggerColumnId: e.target.value })}
                        disabled={pending}
                        className={sel}
                        aria-label="Колонка-триггер"
                      >
                        {realColumns.some((c) => c.id === r.triggerColumnId) ? null : (
                          <option value={r.triggerColumnId}>(колонка недоступна)</option>
                        )}
                        {realColumns.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        value={r.triggerStatus}
                        onChange={(e) => patch(i, { triggerStatus: e.target.value })}
                        disabled={pending}
                        className={sel}
                        aria-label="Категория-триггер"
                      >
                        {categoryOptions.map((c) => (
                          <option key={c.status} value={c.status}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                ) : null}
                <span>→</span>
                <select
                  value={r.actionType}
                  onChange={(e) => {
                    const at = e.target.value as AutomationActionKind;
                    // Reset the value to a sensible default for the new action.
                    const def =
                      at === 'SET_PRIORITY'
                        ? 'HIGH'
                        : at === 'SET_ASSIGNEE'
                          ? members[0]?.id ?? ''
                          : '';
                    patch(i, { actionType: at, actionValue: def });
                  }}
                  disabled={pending}
                  className={sel}
                >
                  {ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {ACTION_LABELS[k]}
                    </option>
                  ))}
                </select>
                {r.actionType === 'SET_ASSIGNEE' ? (
                  <select
                    value={r.actionValue}
                    onChange={(e) => patch(i, { actionValue: e.target.value })}
                    disabled={pending}
                    className={sel}
                  >
                    <option value="">—</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                ) : r.actionType === 'SET_PRIORITY' ? (
                  <select
                    value={r.actionValue}
                    onChange={(e) => patch(i, { actionValue: e.target.value })}
                    disabled={pending}
                    className={sel}
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={r.actionValue}
                    onChange={(e) => patch(i, { actionValue: e.target.value })}
                    disabled={pending}
                    className={sel}
                  >
                    <option value="">Без дорожки</option>
                    {swimlanes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Правил пока нет.</p>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" variant="outline" onClick={addRule} disabled={pending}>
          <Plus className="mr-1 h-4 w-4" />
          Добавить правило
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Сохраняю…' : 'Сохранить'}
        </Button>
        {saved ? <span className="text-xs text-emerald-600">Сохранено</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
    </div>
  );
}
