import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card } from '@giper/ui/components/Card';
import { Avatar } from '@giper/ui/components/Avatar';
import { requireAuth } from '@/lib/auth';
import { listAuditLogs, getAuditFacets } from '@/lib/audit/listAuditLogs';
import { Pagination } from '@/components/domain/Pagination';

type SearchParams = Promise<{
  entity?: string;
  action?: string;
  userId?: string;
  q?: string;
  page?: string;
}>;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await requireAuth();
  if (me.role !== 'ADMIN') notFound();

  const sp = await searchParams;
  const filter = {
    entity: sp.entity,
    action: sp.action,
    userId: sp.userId,
    q: sp.q,
    page: sp.page ? Number(sp.page) : 1,
  };
  const [data, facets] = await Promise.all([
    listAuditLogs(filter),
    getAuditFacets(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <span className="text-sm text-muted-foreground">{data.total} записей</span>
      </div>

      <Card className="p-4">
        <form className="flex flex-wrap items-center gap-3 text-sm">
          <input
            name="q"
            defaultValue={filter.q ?? ''}
            placeholder="entityId / action…"
            className="h-9 min-w-[200px] flex-1 rounded-md border border-input bg-background px-3"
          />
          <label className="flex items-center gap-1 text-muted-foreground">
            Сущность:
            <select
              name="entity"
              defaultValue={filter.entity ?? ''}
              className="h-9 rounded-md border border-input bg-background px-2"
            >
              <option value="">все</option>
              {facets.entities.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-muted-foreground">
            Действие:
            <select
              name="action"
              defaultValue={filter.action ?? ''}
              className="h-9 rounded-md border border-input bg-background px-2"
            >
              <option value="">все</option>
              {facets.actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md border border-input bg-background px-3 py-1.5 hover:bg-accent"
          >
            Применить
          </button>
          {filter.entity || filter.action || filter.q ? (
            <Link
              href="/settings/audit"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              сбросить
            </Link>
          ) : null}
        </form>
      </Card>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Когда</th>
              <th className="px-3 py-2">Кто</th>
              <th className="px-3 py-2">Действие</th>
              <th className="px-3 py-2">Сущность</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Ничего не найдено
                </td>
              </tr>
            ) : (
              data.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {r.user ? (
                      <Link
                        href={`/settings/users/${r.user.id}`}
                        className="inline-flex items-center gap-2 hover:underline"
                      >
                        <Avatar
                          src={r.user.image}
                          alt={r.user.name}
                          className="h-5 w-5"
                        />
                        <span>{r.user.name}</span>
                      </Link>
                    ) : (
                      <span className="text-muted-foreground italic">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
                      {r.action}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.entity}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {r.entityId.slice(0, 12)}
                    {r.entityId.length > 12 ? '…' : ''}
                  </td>
                  <td className="px-3 py-2">
                    {r.diff ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-blue-600">
                          показать
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[10px]">
                          {JSON.stringify(r.diff, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Pagination page={data.page} pageCount={data.pageCount} />
    </div>
  );
}
