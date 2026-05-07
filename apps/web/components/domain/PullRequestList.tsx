import { CheckCircle2, GitMerge, GitPullRequest, GitPullRequestClosed, Pencil } from 'lucide-react';
import type { PullRequestState } from '@giper/db';

type PR = {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: PullRequestState;
  url: string;
  headRef: string | null;
  baseRef: string | null;
  authorLogin: string | null;
  mergedAt: Date | null;
};

const STATE_META: Record<
  PullRequestState,
  { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  OPEN: {
    label: 'Открыт',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Icon: GitPullRequest,
  },
  DRAFT: {
    label: 'Черновик',
    cls: 'border-neutral-200 bg-neutral-50 text-neutral-700',
    Icon: Pencil,
  },
  MERGED: {
    label: 'Влит',
    cls: 'border-purple-200 bg-purple-50 text-purple-800',
    Icon: GitMerge,
  },
  CLOSED: {
    label: 'Закрыт без слияния',
    cls: 'border-red-200 bg-red-50 text-red-800',
    Icon: GitPullRequestClosed,
  },
};

/**
 * Pull-request block on the task detail page. Lists every linked PR with
 * a state badge, branch info, and a clickable link out to GitHub.
 *
 * Linkage is webhook-fed: when a PR title/body/branch contains a
 * `KEY-N` reference, GitHub pings us and we upsert. Manual linking is
 * not supported in v1 — the GH-side reference is the source of truth.
 */
export function PullRequestList({ items }: { items: PR[] }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Связанных PR нет. Упомяните номер задачи в названии PR или ветке —
        связь появится автоматически.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((pr) => {
        const meta = STATE_META[pr.state];
        const Icon = meta.Icon;
        return (
          <li
            key={pr.id}
            className={'flex items-start gap-2 rounded-md border p-2 text-sm ' + meta.cls}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
                title={pr.title}
              >
                {pr.repo}#{pr.number} — {pr.title}
              </a>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[11px] opacity-80">
                <span className="font-medium uppercase tracking-wide">{meta.label}</span>
                {pr.headRef ? (
                  <span>
                    <code>{pr.headRef}</code>
                    {pr.baseRef ? (
                      <>
                        {' → '}
                        <code>{pr.baseRef}</code>
                      </>
                    ) : null}
                  </span>
                ) : null}
                {pr.authorLogin ? <span>@{pr.authorLogin}</span> : null}
                {pr.state === 'MERGED' && pr.mergedAt ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {new Date(pr.mergedAt).toLocaleDateString('ru-RU')}
                  </span>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
