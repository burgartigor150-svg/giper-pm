import { describe, it, expect } from 'vitest';
import {
  mapBitrixStatus,
  mapBitrixPriority,
  mapBitrixTask,
  parseDate,
  stripBitrixHtml,
  convertBitrixMarkup,
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

describe('convertBitrixMarkup — chat system messages', () => {
  // The exact payload pulled from im.dialog.messages.get for a deadline-change
  // system message (task 118224). Previously rendered as "… на [, ](/workgroups…)".
  const RAW_DEADLINE =
    '[USER=1282]Зобков Игорь[/USER] установил крайний срок задачи на ' +
    '[URL=/workgroups/group/930/tasks/task/view/118224/?chatAction=changeDeadline]' +
    '[TIMESTAMP=1785513600 FORMAT=LONG_DATE_FORMAT], ' +
    '[TIMESTAMP=1785513600 FORMAT=SHORT_TIME_FORMAT][/URL]';

  it('drops the relative action-link and recovers the deadline date/time', () => {
    const out = convertBitrixMarkup(RAW_DEADLINE);
    // No raw markup leaks through.
    expect(out).not.toContain('[URL');
    expect(out).not.toContain('[TIMESTAMP');
    expect(out).not.toContain('](/'); // no relative markdown link
    expect(out).not.toContain('/workgroups/');
    // User mention kept, and the date+time are now present.
    expect(out).toMatch(
      /^@Зобков Игорь установил крайний срок задачи на \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/,
    );
  });

  it('formats [TIMESTAMP] in portal (Moscow) time deterministically', () => {
    // 1785513600 = 2026-07-31 16:00 UTC → 19:00 MSK.
    expect(convertBitrixMarkup('[TIMESTAMP=1785513600 FORMAT=LONG_DATE_FORMAT]')).toBe(
      '31.07.2026',
    );
    expect(convertBitrixMarkup('[TIMESTAMP=1785513600 FORMAT=SHORT_TIME_FORMAT]')).toBe(
      '19:00',
    );
  });

  it('keeps absolute links as markdown but strips relative ones to the label', () => {
    expect(convertBitrixMarkup('[URL=https://example.com]сайт[/URL]')).toBe(
      '[сайт](https://example.com)',
    );
    expect(convertBitrixMarkup('[URL=/company/personal/user/42/]Иван[/URL]')).toBe(
      'Иван',
    );
  });

  it('leaves a bare absolute url, drops a bare relative url', () => {
    expect(convertBitrixMarkup('[URL]https://example.com[/URL]')).toBe(
      'https://example.com',
    );
    expect(convertBitrixMarkup('[URL]/workgroups/group/1/[/URL]')).toBe('');
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

  it('extracts PARENT_ID into bitrixParentId, normalizing 0/empty to null', () => {
    expect(mapBitrixTask({ ...sample, parentId: '117000' }).bitrixParentId).toBe('117000');
    expect(mapBitrixTask({ ...sample, parentId: '0' }).bitrixParentId).toBeNull();
    expect(mapBitrixTask({ ...sample, parentId: null }).bitrixParentId).toBeNull();
    expect(mapBitrixTask(sample).bitrixParentId).toBeNull();
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
