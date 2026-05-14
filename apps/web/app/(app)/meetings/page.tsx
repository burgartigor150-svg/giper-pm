import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canSeeSettings } from '@/lib/permissions';
import { CreateMeetingButton } from '@/components/domain/CreateMeetingButton';
import { GroupCallButton } from '@/components/domain/GroupCallButton';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Запланирована',
  ACTIVE: 'Идёт',
  ENDED: 'В очереди',
  PROCESSING: 'Обработка ИИ',
  READY: 'Готово',
  FAILED: 'Ошибка',
};

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: 'bg-red-100 text-red-900',
  PROCESSING: 'bg-amber-100 text-amber-900',
  READY: 'bg-emerald-100 text-emerald-900',
  FAILED: 'bg-red-100 text-red-900',
  PLANNED: 'bg-muted text-muted-foreground',
  ENDED: 'bg-muted text-muted-foreground',
};

export default async function MeetingsListPage() {
  const me = await requireAuth();
  const canCreate = canSeeSettings({ id: me.id, role: me.role });

  // Strictly only meetings the user participated in or created. PM/ADMIN
  // used to see everything via an `OR: [..., {}]` (empty object = match
  // all) — too noisy and a privacy leak for guest call titles.
  const meetings = await prisma.meeting.findMany({
    where: {
      OR: [
        { createdById: me.id },
        { participants: { some: { userId: me.id } } },
      ],
    },
    orderBy: [{ createdAt: 'desc' }],
    take: 60,
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
      recordingDurationSec: true,
      createdAt: true,
      createdBy: { select: { name: true } },
      project: { select: { key: true, name: true } },
      _count: { select: { participants: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Созвоны</h1>
        <div className="flex flex-wrap items-start gap-2">
          <GroupCallButton />
          {canCreate ? <CreateMeetingButton /> : null}
        </div>
      </div>

      {meetings.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Пока нет встреч</CardTitle>
            <CardDescription>
              {canCreate
                ? 'Нажмите «Новая встреча», и мы запустим LiveKit-комнату прямо в браузере. Запись и транскрипт делаются автоматически.'
                : 'Здесь появятся созвоны, в которых вы участвовали. Запустить новый созвон можно из любого чата.'}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-2">
          {meetings.map((m) => (
            <li key={m.id}>
              <Link href={`/meetings/${m.id}`}>
                <Card className="cursor-pointer transition hover:bg-muted/30">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">{m.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.project ? (
                          <>
                            <span className="font-mono">{m.project.key}</span> — {m.project.name} ·{' '}
                          </>
                        ) : null}
                        Создал {m.createdBy.name} · {new Date(m.createdAt).toLocaleString('ru-RU')}
                        {m.recordingDurationSec
                          ? ` · ${Math.round(m.recordingDurationSec / 60)} мин`
                          : ''}
                        {m._count.participants ? ` · ${m._count.participants} уч.` : ''}
                      </div>
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs ${STATUS_COLOR[m.status] ?? ''}`}
                    >
                      {STATUS_LABEL[m.status] ?? m.status}
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
