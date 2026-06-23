'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Plus, RefreshCw, SquareKanban } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import {
  connectKaitenAction,
  disconnectKaitenAction,
  syncKaitenAction,
} from '@/actions/kaitenIntegration';

export type KaitenConnectionStatus = {
  connected: boolean;
  domain?: string;
  boardId?: number;
  spaceId?: number;
  matchScope?: 'project' | 'org';
  tokenHint?: string;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncSummary?: string;
};

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function fmt(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ru-RU');
}

/**
 * Per-project Kaiten board connection. Paste the company domain + API key +
 * board id → cards are imported one-way as tasks and fuzzy-matched to the
 * project's Bitrix-mirrored tasks (linked as duplicates).
 */
export function KaitenConnection({
  projectKey,
  initial,
  canManage,
}: {
  projectKey: string;
  initial: KaitenConnectionStatus;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [domain, setDomain] = useState('');
  const [token, setToken] = useState('');
  const [boardId, setBoardId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [orgScope, setOrgScope] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  function connect() {
    setMsg(null);
    if (!domain.trim() || !token.trim() || !boardId.trim()) {
      setMsg('Укажите домен, API-ключ и ID доски');
      return;
    }
    if (!Number.isInteger(Number(boardId.trim())) || Number(boardId.trim()) <= 0) {
      setMsg('ID доски должен быть положительным числом');
      return;
    }
    if (spaceId.trim() && (!Number.isInteger(Number(spaceId.trim())) || Number(spaceId.trim()) <= 0)) {
      setMsg('ID пространства должен быть положительным числом');
      return;
    }
    start(async () => {
      const res = await connectKaitenAction({
        projectKey,
        domain: domain.trim(),
        token: token.trim(),
        boardId: Number(boardId.trim()),
        spaceId: spaceId.trim() ? Number(spaceId.trim()) : undefined,
        matchScope: orgScope ? 'org' : 'project',
      });
      if (!res.ok) {
        setMsg(`Ошибка: ${res.error}`);
        return;
      }
      setDomain('');
      setToken('');
      setBoardId('');
      setSpaceId('');
      setMsg('Подключено. Запустите синхронизацию, чтобы импортировать карточки.');
      router.refresh();
    });
  }

  function disconnect() {
    start(async () => {
      const res = await disconnectKaitenAction({ projectKey });
      if (!res.ok) setMsg(`Ошибка: ${res.error}`);
      else {
        setMsg(null);
        router.refresh();
      }
    });
  }

  function sync() {
    setMsg(null);
    start(async () => {
      const res = await syncKaitenAction({ projectKey });
      setMsg(res.ok ? res.summary : `Ошибка: ${res.summary}`);
      router.refresh();
    });
  }

  if (initial.connected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
          <SquareKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-mono">{initial.domain}</span>
          <span className="text-xs text-muted-foreground">доска #{initial.boardId}</span>
          {initial.tokenHint ? (
            <span className="text-xs text-muted-foreground">ключ {initial.tokenHint}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            матч: {initial.matchScope === 'org' ? 'все проекты' : 'этот проект'}
          </span>
          <span className="ml-auto rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700">
            подключён
          </span>
        </div>

        {initial.lastSyncAt ? (
          <p className="text-xs text-muted-foreground">
            Последняя синхронизация: {fmt(initial.lastSyncAt)} — {initial.lastSyncStatus}.{' '}
            {initial.lastSyncSummary}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Синхронизация ещё не запускалась.</p>
        )}

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={sync} disabled={pending}>
              <RefreshCw className={'mr-1 h-4 w-4' + (pending ? ' animate-spin' : '')} />
              {pending ? 'Синхронизирую…' : 'Синхронизировать'}
            </Button>
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" /> Отключить
            </button>
            {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Kaiten не подключён к проекту.</p>
      {canManage ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-input p-3">
          <div className="flex flex-wrap gap-2">
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="компания.kaiten.ru"
              className={inputCls + ' flex-1 min-w-[200px]'}
            />
            <input
              value={boardId}
              onChange={(e) => setBoardId(e.target.value)}
              placeholder="ID доски"
              inputMode="numeric"
              className={inputCls + ' w-32'}
            />
            <input
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
              placeholder="ID пространства (необяз.)"
              inputMode="numeric"
              className={inputCls + ' w-44'}
            />
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="API-ключ Kaiten (Профиль → API-ключ)"
            className={inputCls}
            autoComplete="off"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={orgScope} onChange={(e) => setOrgScope(e.target.checked)} />
            Искать дубликаты по всем проектам организации (а не только этому)
          </label>
          <div className="flex items-center gap-2">
            <Button onClick={connect} disabled={pending} className="self-start">
              <Plus className="mr-1 h-4 w-4" />
              {pending ? 'Подключаю…' : 'Подключить Kaiten'}
            </Button>
            {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Импорт односторонний: карточки доски Kaiten создаются как задачи и
            сопоставляются с задачами из Битрикс24 по схожести названия (совпавшие
            помечаются дубликатами). Токен хранится в зашифрованном виде.
          </p>
        </div>
      ) : null}
    </div>
  );
}
