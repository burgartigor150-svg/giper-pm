'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { GitBranch, Trash2, Plus } from 'lucide-react';
import { Button } from '@giper/ui/components/Button';
import { connectRepoAction, disconnectRepoAction } from '@/actions/repoConnections';

type Conn = {
  id: string;
  provider: string;
  repo: string;
  status: string;
  tokenHint: string;
  baseUrl: string | null;
};

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * In-app GitHub/GitLab repository connections for a project. Paste a repo URL
 * + access token → the server validates it, auto-creates the webhook, and
 * backfills open PRs/MRs. No manual webhook setup on the forge side.
 */
export function RepoConnections({
  projectKey,
  initial,
  canManage,
}: {
  projectKey: string;
  initial: Conn[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github');
  const [repoUrl, setRepoUrl] = useState('');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  function connect() {
    setMsg(null);
    if (!repoUrl.trim() || !token.trim()) {
      setMsg('Укажите URL репозитория и токен');
      return;
    }
    start(async () => {
      const res = await connectRepoAction({ projectKey, provider, repoUrl, token });
      if (!res.ok) {
        setMsg(`Ошибка: ${res.error}`);
        return;
      }
      setRepoUrl('');
      setToken('');
      setMsg(
        res.backfilled > 0
          ? `Подключено. Привязано открытых PR/MR: ${res.backfilled}.`
          : 'Подключено. Новые PR/MR будут появляться автоматически.',
      );
      router.refresh();
    });
  }

  function disconnect(id: string) {
    start(async () => {
      const res = await disconnectRepoAction({ projectKey, connectionId: id });
      if (!res.ok) setMsg(`Ошибка: ${res.error}`);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">Репозитории не подключены.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {initial.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
            >
              <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span
                className={
                  'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' +
                  (c.provider === 'gitlab'
                    ? 'bg-orange-100 text-orange-700'
                    : 'bg-neutral-200 text-neutral-700')
                }
              >
                {c.provider}
              </span>
              <span className="font-mono">{c.repo}</span>
              <span className="text-xs text-muted-foreground">токен {c.tokenHint}</span>
              {c.status !== 'active' ? (
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">
                  {c.status}
                </span>
              ) : (
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700">
                  активен
                </span>
              )}
              {canManage ? (
                <button
                  type="button"
                  onClick={() => disconnect(c.id)}
                  disabled={pending}
                  className="ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-red-600"
                  title="Отключить"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Отключить
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-input p-3">
          <div className="flex flex-wrap gap-2">
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as 'github' | 'gitlab')}
              className={inputCls + ' w-auto'}
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
            </select>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder={
                provider === 'github'
                  ? 'https://github.com/owner/repo'
                  : 'https://gitlab.com/group/repo'
              }
              className={inputCls + ' flex-1 min-w-[220px]'}
            />
          </div>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={
              provider === 'github'
                ? 'Personal access token (repo + admin:repo_hook)'
                : 'Project/Group access token (api scope)'
            }
            className={inputCls}
            autoComplete="off"
          />
          <div className="flex items-center gap-2">
            <Button onClick={connect} disabled={pending} className="self-start">
              <Plus className="mr-1 h-4 w-4" />
              {pending ? 'Подключаю…' : 'Подключить репозиторий'}
            </Button>
            {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Токен хранится в зашифрованном виде и используется только для
            создания вебхука и чтения PR/MR. Вебхук добавится автоматически —
            вручную в GitHub/GitLab ничего настраивать не нужно.
          </p>
        </div>
      ) : null}
    </div>
  );
}
