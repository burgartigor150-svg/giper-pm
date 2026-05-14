'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Track, type RoomConnectOptions } from 'livekit-client';
import { Maximize2, Minimize2, PhoneOff, UserPlus } from 'lucide-react';
import { useActiveCall } from './ActiveCallProvider';
import { createMeetingInviteAction, endMeetingAction } from '@/actions/meetings';

/**
 * Global container for the active LiveKit room. Mounted ONCE in the
 * root app layout, so navigation between pages doesn't tear the
 * WebRTC connection down.
 *
 * Two visual modes:
 *   - expanded=true  — fullscreen overlay (used on /meetings/[id]
 *     and when the user clicks "развернуть" on the dock).
 *   - expanded=false — small floating PiP in the bottom-right
 *     corner. Stays draggable / clickable so the user can keep
 *     working in the rest of the app.
 *
 * The page at /meetings/[id] no longer mounts its own LiveKitRoom —
 * it just calls setCall() and lets this container handle the
 * connection lifecycle.
 */
export function ActiveCallContainer() {
  const { call, setCall, setExpanded } = useActiveCall();
  const router = useRouter();
  const [endPending, startEnd] = useTransition();
  const [invitePending, startInvite] = useTransition();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!call) return null;

  function hangUp() {
    if (!call) return;
    const id = call.meetingId;
    startEnd(async () => {
      try {
        await endMeetingAction({ meetingId: id });
      } catch {
        /* swallow — the room close below is what really ends the
           session for this client */
      }
      setCall(null);
      router.refresh();
    });
  }

  function issueInvite() {
    if (!call) return;
    setInviteErr(null);
    setCopied(false);
    if (inviteUrl) {
      // Already have a link — second click hides the panel so it
      // doesn't clutter the dock.
      setInviteUrl(null);
      return;
    }
    const id = call.meetingId;
    startInvite(async () => {
      const r = await createMeetingInviteAction({ meetingId: id, expiresInHours: 24 });
      if (!r.ok) {
        setInviteErr(r.message);
        return;
      }
      setInviteUrl(r.url);
    });
  }

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Скопируйте ссылку вручную:', inviteUrl);
    }
  }

  const rtcConfig: RoomConnectOptions = {
    autoSubscribe: true,
  };

  return (
    <div
      className={
        call.expanded
          ? 'fixed inset-0 z-[60] flex flex-col bg-background'
          : // Dock: bottom-right floating card. Width = 320, height
            // adjusted to a 16:9-ish frame. Above all standard z-30
            // popovers, below modal z-[70].
            'fixed bottom-3 right-3 z-[60] flex w-56 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg sm:bottom-4 sm:right-4 sm:w-80'
      }
      role="dialog"
      aria-label={`Активный звонок: ${call.title}`}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-3">
        <div className="flex items-center gap-2 truncate text-sm">
          <span className="inline-block size-2 animate-pulse rounded-full bg-destructive" />
          <span className="truncate font-medium">{call.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={issueInvite}
            disabled={invitePending}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Пригласить гостя по ссылке"
            title="Пригласить гостя по ссылке"
          >
            <UserPlus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!call.expanded)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={call.expanded ? 'Свернуть' : 'Развернуть'}
            title={call.expanded ? 'Свернуть' : 'Развернуть'}
          >
            {call.expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={hangUp}
            disabled={endPending}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label="Завершить звонок"
            title="Завершить звонок"
          >
            <PhoneOff className="size-4" />
          </button>
        </div>
      </header>
      {/*
        Guest invite result panel. Appears only after the user clicks
        the UserPlus icon and a token gets issued. Works both in dock
        and expanded layouts. The "copy" action is inline so guests
        can be shared without leaving the call surface.
      */}
      {inviteErr ? (
        <div className="shrink-0 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {inviteErr}
        </div>
      ) : null}
      {inviteUrl ? (
        <div className="shrink-0 border-b border-border bg-muted/40 px-3 py-2 text-xs">
          <div className="mb-1 text-muted-foreground">
            Гостевая ссылка (24 ч). Поделитесь с внешним участником:
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 font-mono">
              {inviteUrl}
            </code>
            <button
              type="button"
              onClick={copyInvite}
              className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
            >
              {copied ? '✓' : 'Копировать'}
            </button>
          </div>
        </div>
      ) : null}
      <div className="relative flex-1 min-h-0">
        <LiveKitRoom
          // key forces a single mount per token — without it React
          // strict-mode-double-mount would spawn two sockets with the
          // same identity. The container above already handles
          // "navigate without unmounting", so the key only refires
          // when the token actually changes (new call).
          key={call.token}
          serverUrl={call.serverUrl}
          token={call.token}
          connect
          audio
          video
          connectOptions={rtcConfig}
          data-lk-theme="default"
          onDisconnected={(reason) => {
            // eslint-disable-next-line no-console
            console.log('[active-call] disconnected', reason);
            // Don't auto-tear down here. The user may have been
            // momentarily disconnected (network blip); LiveKit
            // auto-reconnects. Only explicit hangUp() clears the
            // context.
          }}
          onError={(e) => {
            // eslint-disable-next-line no-console
            console.error('[active-call] LiveKit error', e);
          }}
          style={{ height: '100%' }}
        >
          {call.expanded ? <ConferenceLayout /> : <DockLayout />}
          <RoomAudioRenderer />
          {call.expanded ? <ControlBar /> : null}
        </LiveKitRoom>
      </div>
    </div>
  );
}

/**
 * Full conference layout — same as before, lifted out of MeetingRoom.
 * Grid by default, focus when something's pinned or screen-shared.
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
      <div style={{ height: 'calc(100vh - 8rem)' }}>
        {focused ? (
          <FocusLayoutContainer>
            <CarouselLayout tracks={others}>
              <ParticipantTile />
            </CarouselLayout>
            <FocusLayout trackRef={focused} />
          </FocusLayoutContainer>
        ) : (
          <GridLayout tracks={tracks}>
            <ParticipantTile />
          </GridLayout>
        )}
      </div>
    </LayoutContextProvider>
  );
}

/**
 * Dock layout — show one tile (focus / first camera), no carousel,
 * no chrome. Just the picture so the user can still see who's on
 * the call while typing in a chat.
 */
function DockLayout() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  );
  // Pick the first non-local camera track (so we see *someone else*
  // by default — the local feed isn't very useful in the dock).
  const remote = tracks.find((t) => !t.participant.isLocal) ?? tracks[0];
  if (!remote) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        Ожидаем собеседника…
      </div>
    );
  }
  return (
    <div className="h-40 w-full">
      <ParticipantTile trackRef={remote} />
    </div>
  );
}
