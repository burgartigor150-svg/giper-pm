export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type SlaState = 'none' | 'on-track' | 'due-soon' | 'breached' | 'met';

/** Default per-priority SLA targets (hours). Configurable policies are a follow-up. */
export const DEFAULT_SLA: Record<Priority, { responseHours: number; resolutionHours: number }> = {
  URGENT: { responseHours: 1, resolutionHours: 4 },
  HIGH: { responseHours: 4, resolutionHours: 24 },
  MEDIUM: { responseHours: 8, resolutionHours: 72 },
  LOW: { responseHours: 24, resolutionHours: 168 },
};

const HOUR = 3_600_000;
const DUE_SOON_MS = HOUR; // flag amber within the last hour before a due time

/** Compute SLA due timestamps for a ticket of `priority` created at `createdAt`. */
export function computeDueAts(priority: Priority, createdAt: Date): {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
} {
  const p = DEFAULT_SLA[priority];
  const base = createdAt.getTime();
  return {
    firstResponseDueAt: new Date(base + p.responseHours * HOUR),
    resolutionDueAt: new Date(base + p.resolutionHours * HOUR),
  };
}

/**
 * Derive a single SLA clock's state from its due time + the timestamp that
 * stops it (response → firstRespondedAt, resolution → resolvedAt), at `now`.
 * Stored nowhere — always computed, so it never goes stale.
 */
export function slaStateFor(dueAt: Date | null, doneAt: Date | null, now: number): SlaState {
  if (!dueAt) return 'none';
  // The clock stopped (responded/resolved). It only counts as 'met' if it
  // stopped BEFORE the due time — a late stop is a breach (it missed the SLA),
  // otherwise SLA reports would hide every late response/resolution as in-срок.
  if (doneAt) return doneAt.getTime() <= dueAt.getTime() ? 'met' : 'breached';
  const ms = dueAt.getTime() - now;
  if (ms <= 0) return 'breached';
  if (ms <= DUE_SOON_MS) return 'due-soon';
  return 'on-track';
}

const SEVERITY: Record<SlaState, number> = {
  breached: 4,
  'due-soon': 3,
  'on-track': 2,
  met: 1,
  none: 0,
};

/** The worse of a ticket's response- and resolution-SLA states (for one badge). */
export function ticketSlaState(
  t: {
    firstResponseDueAt: Date | null;
    resolutionDueAt: Date | null;
    firstRespondedAt: Date | null;
    resolvedAt: Date | null;
  },
  now: number,
): SlaState {
  const resp = slaStateFor(t.firstResponseDueAt, t.firstRespondedAt, now);
  const res = slaStateFor(t.resolutionDueAt, t.resolvedAt, now);
  return SEVERITY[resp] >= SEVERITY[res] ? resp : res;
}
