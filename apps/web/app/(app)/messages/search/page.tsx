import Link from 'next/link';
import { requireAuth } from '@/lib/auth';
import { searchMessagesAction } from '@/actions/messenger';
import { renderRichText } from '@/lib/text/renderRichText';

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
            <li key={m.id} className="rounded-md border border-border bg-background p-3">
              <Link
                href={`/messages/${m.channelId}`}
                className="block whitespace-pre-wrap break-words text-sm hover:underline"
              >
                {renderRichText(m.body)}
              </Link>
              <div className="mt-1 text-xs text-muted-foreground">
                {new Date(m.createdAt).toLocaleString('ru-RU')}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
