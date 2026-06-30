import Link from 'next/link';
import { Fragment } from 'react';
import { requireAuth } from '@/lib/auth';
import { searchMessagesAction } from '@/actions/messenger';

/**
 * Render a ts_headline string ("…<<match>>…") with the matched spans
 * emphasised. The markers are server-controlled (not user input), and we
 * render only plain text segments, so this is XSS-safe without dangerouslySet.
 */
function Highlighted({ headline }: { headline: string }) {
  const parts = headline.split(/(<<[^>]*>>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('<<') && p.endsWith('>>') ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700/50">
            {p.slice(2, -2)}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

type SearchParams = Promise<{ q?: string }>;

export default async function MessagesSearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAuth();
  const { q = '' } = await searchParams;
  const results = q.trim().length >= 2 ? await searchMessagesAction({ q }) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Поиск по сообщениям</h1>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="что искать…"
          autoFocus
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Искать
        </button>
      </form>

      {q && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ничего не найдено.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {results.map((m) => (
            <li key={m.id}>
              <Link
                href={`/messages/${m.channelId}?msg=${m.id}`}
                className="block rounded-md border border-border bg-background p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{m.authorName}</span>
                  <span>в «{m.channelName}»</span>
                  <span className="ml-auto tabular-nums">
                    {new Date(m.createdAt).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="whitespace-pre-wrap break-words text-sm">
                  <Highlighted headline={m.headline || m.body} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
