import { describe, it, expect } from 'vitest';
import {
  mapBitrixStatus,
  mapBitrixPriority,
  mapBitrixTask,
  parseDate,
  stripBitrixHtml,
} from './mappers';

describe('mapBitrixStatus', () => {
  it('maps every documented bitrix status', () => {
    expect(mapBitrixStatus('1')).toBe('TODO');
    expect(mapBitrixStatus('2')).toBe('TODO');
    expect(mapBitrixStatus('3')).toBe('IN_PROGRESS');
    expect(mapBitrixStatus('4')).toBe('REVIEW');
    expect(mapBitrixStatus('5')).toBe('DONE');
    expect(mapBitrixStatus('6')).toBe('BACKLOG');
    expect(mapBitrixStatus('7')).toBe('CANCELED');
  });
  it('falls back to TODO for unknown / missing', () => {
    expect(mapBitrixStatus('999')).toBe('TODO');
    expect(mapBitrixStatus(undefined)).toBe('TODO');
    expect(mapBitrixStatus('')).toBe('TODO');
  });
});

describe('mapBitrixPriority', () => {
  it('handles 0/1/2', () => {
    expect(mapBitrixPriority('0')).toBe('LOW');
    expect(mapBitrixPriority('1')).toBe('MEDIUM');
    expect(mapBitrixPriority('2')).toBe('HIGH');
  });
  it('falls back to MEDIUM', () => {
    expect(mapBitrixPriority(undefined)).toBe('MEDIUM');
    expect(mapBitrixPriority('5')).toBe('MEDIUM');
  });
});

describe('parseDate', () => {
  it('parses ISO 8601 with timezone', () => {
    const d = parseDate('2026-05-06T19:35:54+03:00');
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBeGreaterThan(0);
  });
  it('returns null for empty / null / undefined / invalid', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('stripBitrixHtml', () => {
  it('strips common tags but keeps text', () => {
    expect(stripBitrixHtml('<p>hello<br/>world</p>')).toBe('hello\nworld');
  });
  it('decodes basic entities', () => {
    expect(stripBitrixHtml('&lt;ok&gt;&amp;&nbsp;done')).toBe('<ok>& done');
  });
  it('clamps long input to the 50k-char ceiling', () => {
    // No markup → length passes through, then sliced at 50_000.
    const big = 'x'.repeat(60_000);
    expect(stripBitrixHtml(big).length).toBe(50_000);
  });
});

describe('mapBitrixTask', () => {
  const sample = {
    id: '117184',
    title: 'Документ X',
    description: '<p>Описание</p>',
    status: '3',
    priority: '2',
    groupId: '894',
    responsibleId: '17',
    createdBy: '1282',
    createdDate: '2026-05-06T10:00:00+03:00',
    changedDate: '2026-05-06T19:35:54+03:00',
    closedDate: null,
    deadline: '2026-05-07T18:00:00+03:00',
    startDatePlan: '2026-05-06T09:00:00+03:00',
  };

  it('maps a full task to domain shape', () => {
    const m = mapBitrixTask(sample);
    expect(m).toEqual(
      expect.objectContaining({
        externalId: '117184',
        externalSource: 'bitrix24',
        title: 'Документ X',
        description: 'Описание',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
        bitrixGroupId: '894',
        bitrixResponsibleId: '17',
        bitrixCreatedById: '1282',
      }),
    );
    expect(m.dueDate).toBeInstanceOf(Date);
    expect(m.startedAt).toBeInstanceOf(Date);
    expect(m.completedAt).toBeNull();
  });

  it('treats groupId="0" as no group', () => {
    const m = mapBitrixTask({ ...sample, groupId: '0' });
    expect(m.bitrixGroupId).toBeNull();
  });

  it('caps title at 200 chars', () => {
    const m = mapBitrixTask({ ...sample, title: 'a'.repeat(500) });
    expect(m.title.length).toBe(200);
  });

  it('only sets completedAt when status maps to DONE', () => {
    const done = mapBitrixTask({
      ...sample,
      status: '5',
      closedDate: '2026-05-06T20:00:00+03:00',
    });
    expect(done.status).toBe('DONE');
    expect(done.completedAt).toBeInstanceOf(Date);

    const inProgress = mapBitrixTask({ ...sample, closedDate: '2026-05-06T20:00:00+03:00' });
    expect(inProgress.status).toBe('IN_PROGRESS');
    expect(inProgress.completedAt).toBeNull();
  });
});
