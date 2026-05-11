import { describe, it, expect } from 'vitest';
import { extractTaskRefs } from './taskRefs';

/**
 * The parser is the contract between message bodies and the
 * rich-preview pipeline. Misparsing is a real bug — it can either
 * leak previews of unrelated tasks (regex too loose) or silently
 * hide real references (regex too tight). Pin behaviour here.
 */

describe('extractTaskRefs — short form', () => {
  it('finds GPM-142 in plain text', () => {
    expect(extractTaskRefs('посмотри пожалуйста GPM-142 завтра')).toEqual([
      { key: 'GPM', number: 142 },
    ]);
  });

  it('requires uppercase 2–5 letter prefix', () => {
    // lowercase — not a key
    expect(extractTaskRefs('gpm-142')).toEqual([]);
    // 1 letter — too short
    expect(extractTaskRefs('A-142')).toEqual([]);
    // 6 letters — too long
    expect(extractTaskRefs('PROJEC-142')).toEqual([]);
    // exactly 2 letters — fine
    expect(extractTaskRefs('OK-1')).toEqual([{ key: 'OK', number: 1 }]);
    // exactly 5 letters — fine
    expect(extractTaskRefs('ABCDE-99')).toEqual([{ key: 'ABCDE', number: 99 }]);
  });

  it('rejects refs preceded by a digit (1GPM-1 is not a task ref)', () => {
    // The lookbehind forbids ANOTHER digit right before the key.
    // But it does NOT forbid letters — there's no way for the regex
    // to tell that "X" + "GPM-1" is two tokens vs that "XGPM" is a
    // 4-letter key. Lookup-stage neutralises the false positive.
    expect(extractTaskRefs('1GPM-1')).toEqual([]);
    expect(extractTaskRefs('GPM-1')).toEqual([{ key: 'GPM', number: 1 }]);
    expect(extractTaskRefs('MFOO-1')).toEqual([{ key: 'MFOO', number: 1 }]);
    // Letters before would just become part of the key (up to 5):
    expect(extractTaskRefs('XGPM-1')).toEqual([{ key: 'XGPM', number: 1 }]);
  });

  it('rejects zero/negative/empty numbers', () => {
    expect(extractTaskRefs('GPM-0')).toEqual([]);
    expect(extractTaskRefs('GPM-')).toEqual([]);
    expect(extractTaskRefs('GPM-abc')).toEqual([]);
  });

  it('caps numbers at 6 digits', () => {
    // 1_000_000 = 7 digits → no match. We don't have a project
    // with that many tasks.
    expect(extractTaskRefs('GPM-1234567')).toEqual([]);
    // 6 digits — fine.
    expect(extractTaskRefs('GPM-999999')).toEqual([{ key: 'GPM', number: 999999 }]);
  });
});

describe('extractTaskRefs — URL path', () => {
  it('finds /projects/KEY/tasks/N path', () => {
    expect(extractTaskRefs('гляди /projects/GPM/tasks/42 пж')).toEqual([
      { key: 'GPM', number: 42 },
    ]);
  });

  it('accepts full URL with host', () => {
    expect(
      extractTaskRefs('https://pm.since-b24-ru.ru/projects/OPS/tasks/7 done'),
    ).toEqual([{ key: 'OPS', number: 7 }]);
  });

  it('normalises key to uppercase (URLs can be sloppy)', () => {
    expect(extractTaskRefs('/projects/gpm/tasks/42')).toEqual([
      { key: 'GPM', number: 42 },
    ]);
  });
});

describe('extractTaskRefs — dedup', () => {
  it('returns each (key, number) only once even if mentioned multiple times', () => {
    const body =
      'смотри GPM-142, ссылка /projects/GPM/tasks/142 — это та же задача что и https://pm.since-b24-ru.ru/projects/GPM/tasks/142';
    expect(extractTaskRefs(body)).toEqual([{ key: 'GPM', number: 142 }]);
  });

  it('different tasks in the same message all surface', () => {
    const body = 'делим: GPM-1, GPM-2, и /projects/OPS/tasks/9';
    const refs = extractTaskRefs(body);
    const keys = refs.map((r) => `${r.key}-${r.number}`).sort();
    expect(keys).toEqual(['GPM-1', 'GPM-2', 'OPS-9']);
  });
});

describe('extractTaskRefs — edges', () => {
  it('empty / null / undefined → []', () => {
    expect(extractTaskRefs('')).toEqual([]);
    expect(extractTaskRefs(null)).toEqual([]);
    expect(extractTaskRefs(undefined)).toEqual([]);
  });

  it('does match strings that are syntactically valid keys (UTF-8, ASCII-7) — server lookup neutralises', () => {
    // The parser is purely syntactic. "UTF-8" and "ASCII-7" both
    // pass the shape (2-5 uppercase + dash + digits). Semantic
    // filtering happens server-side: loadTaskPreviewsForRefs returns
    // `visible: false` for refs that don't match any task, and the
    // TaskPreviewCard renders a muted "нет доступа" stub. So even
    // if a user types "UTF-8", they don't get a real preview card.
    const refs = extractTaskRefs('UTF-8 codec вроде ASCII-7');
    const keys = refs.map((r) => `${r.key}-${r.number}`).sort();
    expect(keys).toEqual(['ASCII-7', 'UTF-8']);
  });

  it('keeps stateful regex hygiene (lastIndex reset between calls)', () => {
    // Bug class: forgetting to reset .lastIndex on a /g regex skips
    // matches on the second invocation. Cover by calling twice.
    expect(extractTaskRefs('GPM-1')).toEqual([{ key: 'GPM', number: 1 }]);
    expect(extractTaskRefs('GPM-2')).toEqual([{ key: 'GPM', number: 2 }]);
    expect(extractTaskRefs('GPM-3')).toEqual([{ key: 'GPM', number: 3 }]);
  });
});
