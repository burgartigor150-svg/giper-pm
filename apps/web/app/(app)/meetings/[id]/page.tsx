import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@giper/db';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { Button } from '@giper/ui/components/Button';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments, canSeeSettings } from '@/lib/permissions';
import { joinMeetingAction } from '@/actions/meetings';
import { MeetingRoom } from '@/components/domain/MeetingRoom';
import { MeetingReadyView } from '@/components/domain/MeetingReadyView';
import { MeetingRetryButton } from '@/components/domain/MeetingRetryButton';
import { getSignedDownloadUrl } from '@/lib/storage/s3';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Не начата',
  ACTIVE: 'Идёт сейчас',
  ENDED: 'В очереди на обработку',
  PROCESSING: 'ИИ читает встречу…',
  READY: 'Готово',
  FAILED: 'Ошибка',
};

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) notFound();

  const meeting = await prisma.meeting.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      kind: true,
      startedAt: true,
      endedAt: true,
      recordingKey: true,
      recordingDurationSec: true,
      processingError: true,
      createdById: true,
      createdAt: true,
      project: {
        select: {
          id: true,
          key: true,
          name: true,
          ownerId: true,
          members: { select: { userId: true, role: true } },
        },
      },
      transcript: {
        select: {
          fullText: true,
          segments: true,
          summary: true,
          language: true,
          model: true,
        },
      },
    },
  });
  if (!meeting) notFound();

  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    (meeting.project &&
      canManageAssignments({ id: me.id, role: me.role }, meeting.project));
  if (!allowed) notFound();

  // PLANNED / ACTIVE — render the live room. We mint the join token on
  // the server (`joinMeetingAction`) and pass it to the client.
  if (meeting.status === 'PLANNED' || meeting.status === 'ACTIVE') {
    const join = await joinMeetingAction({ meetingId: meeting.id });
    if (!join.ok) {
      // Token error — fall through to the info card below.
      return <ErrorCard meetingId={meeting.id} title={meeting.title} message={join.message} />;
    }
    return (
      <MeetingRoom
        meetingId={meeting.id}
        serverUrl={join.serverUrl}
        token={join.token}
        title={meeting.title}
        defaultName={join.displayName}
        iceServers={join.iceServers}
      />
    );
  }

  // ENDED / PROCESSING — info card with auto-poll hint.
  if (meeting.status === 'ENDED' || meeting.status === 'PROCESSING') {
    return (
      <ProcessingCard
        meetingId={meeting.id}
        title={meeting.title}
        status={meeting.status}
        durationSec={meeting.recordingDurationSec}
      />
    );
  }

  // READY — full card with player + transcript + AI.
  if (meeting.status === 'READY' && meeting.transcript) {
    const recordingUrl = meeting.recordingKey
      ? await getSignedDownloadUrl({
          key: meeting.recordingKey,
          filename: `meeting-${meeting.id}.mp4`,
          contentType: 'video/mp4',
          ttlSeconds: 3600,
        })
      : null;

    // Build SPEAKER_xx → real name mapping. WhisperX numbers speakers
    // in voice-onset order; we approximate that with the join order of
    // MeetingParticipant rows. Not perfect (a silent participant who
    // joined first won't claim SPEAKER_00) but it's the right call most
    // of the time and is correctable later via a manual UI.
    const parts = await prisma.meetingParticipant.findMany({
      where: { meetingId: meeting.id },
      orderBy: { joinedAt: 'asc' },
      select: { displayName: true, user: { select: { name: true } } },
    });
    const speakerMap: Record<string, string> = {};
    parts.forEach((p, i) => {
      const idx = String(i).padStart(2, '0');
      speakerMap[`SPEAKER_${idx}`] = p.user?.name || p.displayName || `Участник ${i + 1}`;
    });

    // If the meeting has no project yet, surface the PM's manageable
    // projects so they can attach the meeting after the fact and rerun
    // the AI layer. We only load this list on the no-project branch.
    let availableProjects: { key: string; name: string }[] = [];
    if (!meeting.project) {
      const projects = await prisma.project.findMany({
        where:
          me.role === 'ADMIN'
            ? { status: { not: 'ARCHIVED' } }
            : {
                status: { not: 'ARCHIVED' },
                OR: [
                  { ownerId: me.id },
                  { members: { some: { userId: me.id, role: 'LEAD' } } },
                ],
              },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
        take: 200,
      });
      availableProjects = projects;
    }
    return (
      <MeetingReadyView
        meetingId={meeting.id}
        title={meeting.title}
        recordingUrl={recordingUrl}
        durationSec={meeting.recordingDurationSec ?? null}
        transcript={{
          fullText: meeting.transcript.fullText,
          segments: meeting.transcript.segments as unknown as {
            start: number;
            end: number;
            text: string;
            speaker?: string;
          }[],
          summary: meeting.transcript.summary,
          language: meeting.transcript.language,
        }}
        projectKey={meeting.project?.key ?? null}
        speakerMap={speakerMap}
        availableProjects={availableProjects}
      />
    );
  }

  // FAILED.
  return (
    <ErrorCard
      meetingId={meeting.id}
      title={meeting.title}
      message={meeting.processingError || 'Неизвестная ошибка обработки'}
    />
  );
}

function ProcessingCard({
  meetingId,
  title,
  status,
  durationSec,
}: {
  meetingId: string;
  title: string;
  status: string;
  durationSec: number | null;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {STATUS_LABEL[status]}. Обычно занимает 5–15 минут на час записи. Страница обновится
            автоматически.
          </p>
          {durationSec ? (
            <p>Длительность: {Math.round(durationSec / 60)} мин.</p>
          ) : null}
          <p className="text-xs">
            ИИ-конвейер: WhisperX (распознавание + спикеры) → Qwen 14B (саммари + предложенные
            задачи).
          </p>
        </CardContent>
      </Card>
      <meta httpEquiv="refresh" content={`15;url=/meetings/${meetingId}`} />
      <p className="text-center text-xs text-muted-foreground">
        Авто-обновление каждые 15 секунд.{' '}
        <Link href="/meetings" className="underline">
          К списку встреч
        </Link>
      </p>
    </div>
  );
}

function ErrorCard({
  meetingId,
  title,
  message,
}: {
  meetingId: string;
  title: string;
  message: string;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message}
          </p>
          <Link href="/meetings">
            <Button variant="outline" size="sm">
              ← К списку
            </Button>
          </Link>
          <MeetingRetryButton meetingId={meetingId} />
        </CardContent>
      </Card>
    </div>
  );
}
