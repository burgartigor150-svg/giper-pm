import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@giper/db';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { Button } from '@giper/ui/components/Button';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments } from '@/lib/permissions';
import { joinMeetingAction } from '@/actions/meetings';
import { MeetingRoomMount } from '@/components/domain/MeetingRoomMount';
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
      channelId: true,
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
          speakerMap: true,
        },
      },
    },
  });
  if (!meeting) notFound();

  // Access: creator, ADMIN, PM/owner of attached project, channel-
  // visible (chat-originated meetings inherit chat visibility), or a
  // listed invitee in MeetingParticipant. The roster check is what
  // makes ad-hoc group calls work for plain MEMBER invitees who don't
  // share any other context with the caller.
  let channelAllowed = false;
  if (meeting.channelId) {
    const { resolveChannelAccess } = await import('@/lib/messenger/access');
    const acc = await resolveChannelAccess(meeting.channelId, me.id);
    channelAllowed = !!acc?.canRead;
  }
  let invited = false;
  if (
    me.role !== 'ADMIN' &&
    meeting.createdById !== me.id &&
    !channelAllowed
  ) {
    const roster = await prisma.meetingParticipant.findFirst({
      where: { meetingId: meeting.id, userId: me.id },
      select: { id: true },
    });
    invited = !!roster;
  }
  const projectAllowed =
    !!meeting.project &&
    canManageAssignments({ id: me.id, role: me.role }, meeting.project);
  const allowed =
    me.role === 'ADMIN' ||
    meeting.createdById === me.id ||
    channelAllowed ||
    invited ||
    projectAllowed;
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
      <MeetingRoomMount
        meetingId={meeting.id}
        serverUrl={join.serverUrl}
        token={join.token}
        title={meeting.title}
        defaultName={join.displayName}
        iceServers={join.iceServers}
        channelId={null}
      />
    );
    // Note: «Пригласить гостя по ссылке» lives in the floating call
    // toolbar (ActiveCallContainer), not on the page — the room UI
    // overlays the page once setCall fires.
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

    // Build SPEAKER_xx → display-name mapping. Two sources, in
    // priority order:
    //
    //   1. MeetingTranscript.speakerMap — explicit pins set by a PM
    //      via the speaker editor on this page. Shape:
    //        { "SPEAKER_00": { userId?: string|null, name: string } }
    //   2. Fallback: «Спикер N+1» (1-based for human users).
    //
    // The old code used participant-join-order as a heuristic and got
    // it wrong most of the time (silent listeners stole SPEAKER_00,
    // late speakers got mismatched). Honest "Спикер N" is more useful
    // than fabricated names — and the editor turns it into real names
    // for any segment the PM cares to fix.
    type SpeakerMapEntry = { userId?: string | null; name: string };
    const savedMap = (meeting.transcript.speakerMap ?? {}) as Record<
      string,
      SpeakerMapEntry
    >;

    // Collect every SPEAKER_xx that actually appears in the transcript
    // so the editor offers exactly those labels (not a hard-coded
    // SPEAKER_00..SPEAKER_09 list).
    const segArr = (meeting.transcript.segments as unknown as {
      speaker?: string | null;
    }[]) || [];
    const labelSet = new Set<string>();
    for (const s of segArr) {
      if (s.speaker && /^SPEAKER_\d+$/.test(s.speaker)) labelSet.add(s.speaker);
    }
    const speakerLabels = Array.from(labelSet).sort();
    const speakerMap: Record<string, string> = {};
    speakerLabels.forEach((lbl, i) => {
      const saved = savedMap[lbl];
      speakerMap[lbl] = saved?.name?.trim() || `Спикер ${i + 1}`;
    });

    // Participants list for the speaker-editor dropdown — everyone
    // who actually joined the room.
    const parts = await prisma.meetingParticipant.findMany({
      where: { meetingId: meeting.id },
      orderBy: { joinedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        displayName: true,
        user: { select: { name: true } },
      },
    });
    const participantOptions = parts.map((p) => ({
      key: p.id,
      userId: p.userId,
      label: p.user?.name || p.displayName || 'Участник',
    }));

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
        speakerLabels={speakerLabels}
        savedSpeakerMap={savedMap}
        participantOptions={participantOptions}
        canEditSpeakers={
          me.role === 'ADMIN' ||
          meeting.createdById === me.id ||
          projectAllowed
        }
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
