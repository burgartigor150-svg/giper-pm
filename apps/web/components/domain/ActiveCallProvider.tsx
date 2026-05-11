'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Global active-call store. Holds the LiveKit token + meeting
 * metadata for ONE call at a time so the container component (mounted
 * once in the root layout) can keep the WebRTC connection alive while
 * the user navigates around the app.
 *
 * Why a context instead of route-mounted state:
 *   - LiveKitRoom unmounts when its host component unmounts.
 *   - The meeting page IS its host component. Navigation away ends
 *     the call.
 *   - Lifting the component to the root layout keeps it mounted
 *     across navigation.
 *
 * Single active call: starting a second one closes the first. Two
 * concurrent calls in one tab are out of scope — it's a chat tool,
 * not a multi-room SIP client.
 */

export type ActiveCall = {
  meetingId: string;
  livekitRoomName: string;
  serverUrl: string;
  token: string;
  identity: string;
  displayName: string;
  title: string;
  channelId?: string | null;
  /**
   * Whether the floating PiP card is collapsed to a small dock vs
   * fullscreen-on-meeting-page. Controlled by the container, but
   * stored here so navigation to /meetings/<id> can re-expand.
   */
  expanded: boolean;
};

type Ctx = {
  call: ActiveCall | null;
  /** Start (or replace) the active call. Pass null to end. */
  setCall: (next: ActiveCall | null) => void;
  /** Local update — toggle expand vs dock without re-issuing the token. */
  setExpanded: (expanded: boolean) => void;
};

const ActiveCallContext = createContext<Ctx | null>(null);

export function ActiveCallProvider({ children }: { children: ReactNode }) {
  const [call, setCallState] = useState<ActiveCall | null>(null);
  // Stable identity for setCall — children that put it in effect
  // dependencies won't trigger spurious re-renders.
  const callRef = useRef(call);
  callRef.current = call;

  const setCall = useCallback((next: ActiveCall | null) => {
    setCallState(next);
  }, []);
  const setExpanded = useCallback((expanded: boolean) => {
    setCallState((prev) => (prev ? { ...prev, expanded } : prev));
  }, []);

  const value = useMemo<Ctx>(() => ({ call, setCall, setExpanded }), [call, setCall, setExpanded]);
  return <ActiveCallContext.Provider value={value}>{children}</ActiveCallContext.Provider>;
}

export function useActiveCall(): Ctx {
  const ctx = useContext(ActiveCallContext);
  if (!ctx) {
    throw new Error('useActiveCall must be used inside <ActiveCallProvider>');
  }
  return ctx;
}
