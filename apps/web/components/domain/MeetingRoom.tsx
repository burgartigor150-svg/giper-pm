'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track } from 'livekit-client';
import { endMeetingAction } from '@/actions/meetings';

export function MeetingRoom({
  meetingId,
  serverUrl,
  token,
  title,
}: {
  meetingId: string;
  serverUrl: string;
  token: string;
  title: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);

  function leaveAndEnd() {
    setLeaving(true);
    startTransition(async () => {
      await endMeetingAction({ meetingId });
      router.push(`/meetings/${meetingId}`);
      router.refresh();
    });
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-red-500" />
          <h1 className="text-sm font-semibold">{title}</h1>
        </div>
        <button
          type="button"
          disabled={leaving}
          onClick={leaveAndEnd}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {leaving ? 'Завершаю…' : 'Завершить встречу'}
        </button>
      </header>
      <div className="flex-1">
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect
          audio
          video
          data-lk-theme="default"
          onDisconnected={() => {
            // If user closed the tab or got disconnected, mark the
            // meeting as ended for them locally — server-side it stays
            // ACTIVE until egress webhook fires or another PM calls
            // endMeeting. That's intentional (multi-user sessions).
            router.push(`/meetings/${meetingId}`);
          }}
          style={{ height: '100%' }}
        >
          <ConferenceLayout />
          <RoomAudioRenderer />
          <ControlBar />
        </LiveKitRoom>
      </div>
    </div>
  );
}

function ConferenceLayout() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: 'calc(100vh - 12rem)' }}>
      <ParticipantTile />
    </GridLayout>
  );
}
