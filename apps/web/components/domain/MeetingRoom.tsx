'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  PreJoin,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, type RoomConnectOptions } from 'livekit-client';

// LocalUserChoices is what <PreJoin onSubmit> hands us. Inline the
// shape we actually consume (audio/video toggles + username) to avoid
// taking a hard dep on the type (livekit-client renamed it across
// versions).
type LocalUserChoices = {
  username: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  videoDeviceId?: string;
  audioDeviceId?: string;
};
import { endMeetingAction } from '@/actions/meetings';

type IceServer = { urls: string[]; username?: string; credential?: string };

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
  iceServers,
}: {
  meetingId: string;
  serverUrl: string;
  token: string;
  title: string;
  defaultName: string;
  iceServers?: IceServer[];
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
  // We also inject custom ICE servers (STUN + TURN with REST creds)
  // via rtcConfig so clients behind symmetric NAT / corporate
  // firewalls can connect through the TURN relay instead of timing
  // out on direct UDP. Without rtcConfig LiveKit only uses its
  // built-in STUN servers.
  const connectOptions = useMemo<RoomConnectOptions>(
    () => ({
      autoSubscribe: true,
      rtcConfig:
        iceServers && iceServers.length > 0
          ? { iceServers, iceTransportPolicy: 'all' }
          : undefined,
    }),
    [iceServers],
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
              // Persist=true autoloads previous choices and immediately
              // submits, skipping the device-picker UI — which is
              // exactly the "PreJoin closes instantly" symptom. Force
              // false so the user always sees the form.
              persistUserChoices={false}
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
      <div className="min-h-0 flex-1">
        <LiveKitRoom
          // key forces a single mount per token — without it React can
          // strict-mode-double-mount the component, which spawns two
          // sockets with the same identity and the second one kicks the
          // first → "video flickers for 1 sec then disappears".
          key={token}
          serverUrl={serverUrl}
          token={token}
          connect
          audio={choices.audioEnabled}
          video={choices.videoEnabled}
          connectOptions={connectOptions}
          data-lk-theme="default"
          onConnected={() => {
            // eslint-disable-next-line no-console
            console.log('[meetings] connected to LiveKit', { meetingId });
          }}
          onError={(e) => {
            // eslint-disable-next-line no-console
            console.error('[meetings] LiveKit error', e);
          }}
          onDisconnected={(reason) => {
            // eslint-disable-next-line no-console
            console.log('[meetings] disconnected', reason);
            // Don't router.push() on every disconnect — that triggers
            // SSR re-render → fresh JWT → fresh connect → kicks the
            // previous session → infinite reconnect loop ("flickering"
            // camera). LiveKit auto-reconnects internally; the user
            // navigates away via the ControlBar Leave button or our
            // header «Завершить встречу».
          }}
          style={{ height: '100%' }}
        >
          {/*
            Flex column so ControlBar is always glued to the bottom
            of the viewport. The previous layout had a hardcoded
            `calc(100vh - 12rem)` height on ConferenceLayout that
            overflowed once 6+ participants stacked with a screen
            share, pushing the ControlBar off-screen.
          */}
          <div className="flex h-full flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
              <ConferenceLayout />
            </div>
            <RoomAudioRenderer />
            <div className="shrink-0">
              <ControlBar />
            </div>
          </div>
        </LiveKitRoom>
      </div>
    </div>
  );
}

/**
 * Layout that scales gracefully from 2 to 30+ participants:
 *
 *  - When nothing is pinned and ≤ 9 participants → plain grid.
 *  - When > 9 participants → grid still, but LiveKit's GridLayout
 *    auto-paginates (it uses a built-in pagination control bar).
 *  - When someone screen-shares OR a tile is pinned → focus layout:
 *    one big tile + horizontal carousel with the rest. Carousel
 *    auto-scrolls and unsubscribes off-screen video tracks (audio
 *    stays subscribed) — that's what saves CPU for 20+ participant
 *    meetings on weak laptops.
 *
 * `useTracks` with `onlySubscribed: false` returns placeholders for
 * participants whose video isn't subscribed yet, so the grid count
 * matches the participant count rather than flickering as people
 * publish.
 */
function ConferenceLayout() {
  const layoutContext = useCreateLayoutContext();
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const screenShare = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const focused = focusTrack ?? screenShare;
  const others = tracks.filter((t) => t !== focused);

  return (
    <LayoutContextProvider value={layoutContext}>
      {/*
        Fill the parent flex slot rather than a fixed viewport-
        relative height. Wrapper above is `min-h-0 flex-1
        overflow-hidden`, which keeps the tiles inside the available
        space and lets ControlBar own its own row.
      */}
      <div className="h-full w-full">
        {focused ? (
          <FocusLayoutContainer>
            <CarouselLayout tracks={others}>
              <ParticipantTile />
            </CarouselLayout>
            {/*
              Double-click the focused tile (typically the screen
              share) → request native fullscreen on the underlying
              <video>. Second double-click exits fullscreen. This is
              the only way to "enlarge" a screen share since
              FocusLayout has no resize handles.
            */}
            <div
              className="relative h-full w-full"
              onDoubleClick={(e) => {
                const root = e.currentTarget;
                const video = root.querySelector('video');
                const target = video ?? root;
                if (document.fullscreenElement) {
                  void document.exitFullscreen();
                } else {
                  void target.requestFullscreen?.();
                }
              }}
              title="Двойной клик — на весь экран"
            >
              <FocusLayout trackRef={focused} />
            </div>
          </FocusLayoutContainer>
        ) : (
          // GridLayout caps simultaneous renders at 9 by default and
          // shows pagination dots when more participants are present.
          <GridLayout tracks={tracks}>
            <ParticipantTile />
          </GridLayout>
        )}
      </div>
    </LayoutContextProvider>
  );
}

