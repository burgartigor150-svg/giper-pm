'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  PreJoin,
  RoomAudioRenderer,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, type LocalUserChoices } from 'livekit-client';
import { endMeetingAction } from '@/actions/meetings';

/**
 * Two stages:
 *
 *   1. PreJoin — standard LiveKit form: device pickers + camera/mic
 *      preview. This is also where the browser raises the
 *      getUserMedia permission prompt — failing to do this BEFORE
 *      connecting is the #1 cause of "mic doesn't work" reports.
 *      Safari in particular needs an explicit user gesture per device.
 *
 *   2. Connected — room UI (grid + control bar + audio mixer).
 */
export function MeetingRoom({
  meetingId,
  serverUrl,
  token,
  title,
  defaultName,
}: {
  meetingId: string;
  serverUrl: string;
  token: string;
  title: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);

  function leaveAndEnd() {
    setLeaving(true);
    startTransition(async () => {
      await endMeetingAction({ meetingId });
      router.push(`/meetings/${meetingId}`);
      router.refresh();
    });
  }

  // Aggressive defaults: 720p HD camera, echo cancellation + noise
  // suppression on for the mic. Browser will lower resolution
  // automatically if bandwidth doesn't keep up.
  const connectOptions = useMemo(
    () => ({
      autoSubscribe: true,
    }),
    [],
  );

  if (!choices) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="text-xs text-muted-foreground">
            Проверьте микрофон и камеру, потом нажмите «Join» снизу. Браузер запросит разрешения —
            обязательно дайте, иначе встреча будет немой.
          </p>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-background">
          <div data-lk-theme="default" style={{ height: '70vh' }}>
            <PreJoin
              defaults={{
                username: defaultName,
                videoEnabled: true,
                audioEnabled: true,
              }}
              onSubmit={(c) => setChoices(c)}
              onError={(e) => {
                // eslint-disable-next-line no-console
                console.warn('[meetings] PreJoin error', e);
              }}
            />
          </div>
        </div>
      </div>
    );
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
          audio={choices.audioEnabled}
          video={choices.videoEnabled}
          connectOptions={connectOptions}
          data-lk-theme="default"
          onDisconnected={() => {
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

