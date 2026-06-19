import { describe, it, expect } from 'vitest';
import { computeDueAts, slaStateFor, ticketSlaState, DEFAULT_SLA } from './sla';

const H = 3_600_000;

describe('computeDueAts', () => {
  it('stamps response/resolution from the priority policy', () => {
    const created = new Date('2026-06-19T00:00:00.000Z');
    const { firstResponseDueAt, resolutionDueAt } = computeDueAts('HIGH', created);
    expect(firstResponseDueAt.getTime()).toBe(created.getTime() + DEFAULT_SLA.HIGH.responseHours * H);
    expect(resolutionDueAt.getTime()).toBe(created.getTime() + DEFAULT_SLA.HIGH.resolutionHours * H);
  });
});

describe('slaStateFor', () => {
  const now = Date.now();
  it('none when no due time', () => {
    expect(slaStateFor(null, null, now)).toBe('none');
  });
  it('met once the clock is stopped (doneAt set), regardless of due', () => {
    expect(slaStateFor(new Date(now - H), new Date(now), now)).toBe('met');
  });
  it('breached when past due and not done', () => {
    expect(slaStateFor(new Date(now - 1), null, now)).toBe('breached');
  });
  it('due-soon within the last hour', () => {
    expect(slaStateFor(new Date(now + 30 * 60_000), null, now)).toBe('due-soon');
  });
  it('on-track when comfortably ahead', () => {
    expect(slaStateFor(new Date(now + 5 * H), null, now)).toBe('on-track');
  });
});

describe('ticketSlaState', () => {
  const now = Date.now();
  it('reports the WORSE of response and resolution clocks', () => {
    // response breached (past due, no response), resolution on-track.
    const s = ticketSlaState(
      {
        firstResponseDueAt: new Date(now - H),
        firstRespondedAt: null,
        resolutionDueAt: new Date(now + 10 * H),
        resolvedAt: null,
      },
      now,
    );
    expect(s).toBe('breached');
  });
  it('is met when both clocks stopped', () => {
    const s = ticketSlaState(
      {
        firstResponseDueAt: new Date(now - H),
        firstRespondedAt: new Date(now - 2 * H),
        resolutionDueAt: new Date(now - H),
        resolvedAt: new Date(now - 30 * 60_000),
      },
      now,
    );
    expect(s).toBe('met');
  });
});
