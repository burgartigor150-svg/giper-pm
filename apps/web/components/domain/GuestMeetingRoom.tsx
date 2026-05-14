'use client';

import { useMemo, useState } from 'react';
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
import { Track, type RoomConnectOptions } from 'livekit-client';

type LocalUserChoices = {
  username: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
};

type IceServer = { urls: string[]; username?: string; credential?: string };

/**
 * Guest-flavored LiveKit room: no end-meeting button (only the host can
 * close it), no project/channel navigation, no audit hooks. Reuses
 * the PreJoin device picker and the basic grid layout so the guest
 * experience matches what regular members see in the room itself.
 *
 * Why a separate component from MeetingRoom: that one imports
 * endMeetingAction (server action, requires auth) and depends on
 * ActiveCallProvider (mounted only inside (app)/ layout). The /m
 * route runs outside the authenticated layout, so we need a build
 * that doesn't drag those dependencies in.
 */
export function GuestMeetingRoom({
  serverUrl,
  token,
  title,
  defaultName,
  iceServers,
}: {
  serverUrl: string;
  token: string;
  title: string;
  defaultName: string;
  iceServers?: IceServer[];
}) {
  const [choices, setChoices] = useState<LocalUserChoices | null>(null);

  const connectOptions = useMemo<RoomConnectOptions>(
    () => ({
      autoSubscribe: true,
      // If the host configured TURN we pass the credentials here.
      // Empty array is fine — LiveKit falls back to its own STUN.
      rtcConfig: iceServers ? { iceServers } : undefined,
    }),
    [iceServers],
  );

  if (!choices) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black p-4 text-white">
        <div className="w-full max-w-2xl">
          <h1 className="mb-4 text-lg font-semibold">{title}</h1>
          <p className="mb-4 text-sm text-gray-300">
            Это гостевая комната. Проверьте камеру и микрофон, затем подключитесь.
          </p>
          <div className="rounded-md bg-white p-2 text-black">
            <PreJoin
              defaults={{
                username: defaultName,
                videoEnabled: true,
                audioEnabled: true,
              }}
              onSubmit={(c) => setChoices(c)}
              onError={(e) => {
                // eslint-disable-next-line no-console
                console.warn('[guest-meeting] PreJoin error', e);
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-background px-4 py-2">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <h1 className="text-sm font-semibold">{title}</h1>
        <span className="ml-auto text-xs text-muted-foreground">Гость · {defaultName}</span>
      </header>
      <div className="flex-1">
        <LiveKitRoom
          key={token}
          serverUrl={serverUrl}
          token={token}
          connect
          audio={choices.audioEnabled}
          video={choices.videoEnabled}
          connectOptions={connectOptions}
          data-lk-theme="default"
          style={{ height: '100%' }}
          onError={(e) => {
            // eslint-disable-next-line no-console
            console.error('[guest-meeting] LiveKit error', e);
          }}
        >
          <GuestGrid />
          <RoomAudioRenderer />
          <ControlBar />
        </LiveKitRoom>
      </div>
    </div>
  );
}

function GuestGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: 'calc(100% - 60px)' }}>
      <ParticipantTile />
    </GridLayout>
  );
}
