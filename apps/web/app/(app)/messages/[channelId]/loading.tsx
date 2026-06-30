/**
 * Skeleton shown while a channel's messages + sidebar load. Mirrors the
 * MessagesShell two-pane shape so the layout doesn't jump on hydration.
 */
export default function ChannelLoading() {
  return (
    <div className="-mx-4 -my-6 grid h-[calc(100vh-3.5rem)] grid-cols-1 md:-mx-8 md:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-background p-3 md:block">
        <div className="mb-3 h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-md bg-muted/60" />
          ))}
        </div>
      </aside>
      <section className="flex h-full flex-col">
        <div className="h-12 border-b border-border" />
        <div className="flex flex-1 flex-col justify-end gap-3 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-24 animate-pulse rounded bg-muted/60" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted/60" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
