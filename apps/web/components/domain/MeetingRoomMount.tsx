'use client';

import { useEffect, useRef } from 'react';
import { useActiveCall, type ActiveCall } from './ActiveCallProvider';

type IceServer = { urls: string[]; username?: string; credential?: string };

type Props = {
  meetingId: string;
  serverUrl: string;
  token: string;
  title: string;
  defaultName: string;
  iceServers?: IceServer[];
  livekitRoomName?: string;
  channelId?: string | null;
};

/**
 * Hands the meeting metadata to the global ActiveCallProvider so the
 * floating LiveKit container mounted in the root layout can carry the
 * WebRTC connection across navigation. The page itself renders only a
 * placeholder card — the actual video lives in <ActiveCallContainer>.
 *
 * Why a thin wrapper instead of doing this in the server page:
 *   - We need a hook (useEffect) to set/clear the call when the user
 *     opens / leaves the meeting page.
 *   - Server components can't drive client context.
 *
 * Identity guard: the page renders fresh on every navigation, so this
 * effect also fires on every re-render — we de-dupe by token so we
 * don't kick our own session. iceServers/displayName are kept in a
 * ref so they aren't required in the dependency array (otherwise
 * referential identity would trigger spurious re-sets).
 */
export function MeetingRoomMount({
  meetingId,
  serverUrl,
  token,
  title,
  defaultName,
  iceServers,
  livekitRoomName,
  channelId,
}: Props) {
  const { call, setCall } = useActiveCall();
  const ranOnce = useRef<string | null>(null);
  // Keep latest non-token values around for the effect closure without
  // adding them as deps.
  const meta = useRef({ title, defaultName, iceServers, livekitRoomName, channelId, meetingId, serverUrl });
  meta.current = { title, defaultName, iceServers, livekitRoomName, channelId, meetingId, serverUrl };

  useEffect(() => {
    // Same token as already active: don't disturb the running room.
    if (ranOnce.current === token) return;
    ranOnce.current = token;
    const next: ActiveCall = {
      meetingId: meta.current.meetingId,
      livekitRoomName: meta.current.livekitRoomName ?? '',
      serverUrl: meta.current.serverUrl,
      token,
      identity: '',
      displayName: meta.current.defaultName,
      title: meta.current.title,
      channelId: meta.current.channelId ?? null,
      // Meeting page = expanded view by default. If the user comes
      // back to /meetings/<id> after docking, also re-expand —
      // that's what they navigated for.
      expanded: true,
    };
    setCall(next);
    // We deliberately do NOT clear on unmount. Navigation away
    // should keep the call alive in the dock; explicit hangUp is
    // the only way to end it. void iceServers / defaultName / etc.
    // — same reason they're in a ref.
    void iceServers;
    void defaultName;
  }, [token, setCall, iceServers, defaultName]);

  // When we open the meeting page and we already have an active call
  // for the same meeting (came from the dock), nudge it back to
  // expanded.
  useEffect(() => {
    if (call && call.meetingId === meetingId && !call.expanded) {
      setCall({ ...call, expanded: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // The page renders a tiny placeholder so it's not empty — the
  // actual video lives in <ActiveCallContainer> in the root layout.
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Видео подключилось наверху страницы. Нажмите ❐ чтобы свернуть и продолжать
        работать в фоне.
      </p>
    </div>
  );
}
