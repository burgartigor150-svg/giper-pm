import { describe, it, expect } from 'vitest';
import {
  teamlyTypeToColumnType,
  teamlyValueToString,
  optionLabels,
  tableColumns,
  propertyExternalId,
} from '@giper/integrations/teamly';

describe('teamly smart-table mapping', () => {
  it('maps TEAMLY property types to KnowledgeColumnType', () => {
    expect(teamlyTypeToColumnType('number')).toBe('NUMBER');
    expect(teamlyTypeToColumnType('date')).toBe('DATE');
    expect(teamlyTypeToColumnType('checkbox')).toBe('CHECKBOX');
    expect(teamlyTypeToColumnType('select')).toBe('SELECT');
    expect(teamlyTypeToColumnType('multi-select')).toBe('SELECT');
    expect(teamlyTypeToColumnType('url')).toBe('URL');
    expect(teamlyTypeToColumnType('text')).toBe('TEXT');
    expect(teamlyTypeToColumnType('person')).toBe('TEXT');
    expect(teamlyTypeToColumnType('title')).toBe('TEXT');
    expect(teamlyTypeToColumnType(undefined)).toBe('TEXT');
  });

  it('drops hidden + system-metadata columns and sorts by `sort`', () => {
    const cols = tableColumns({
      id: 's',
      title: 't',
      description: null,
      schemaProperties: [
        { code: 'c2', type: 'text', sort: 2 },
        { code: 'author', type: 'person', sort: 0 },
        { code: 'executionDate', type: 'date', sort: 1 },
        { code: 'c1', type: 'text', sort: 1 },
        { code: 'hid', type: 'text', sort: 3, hide: true },
      ],
    });
    expect(cols.map((c) => c.code)).toEqual(['c1', 'c2']);
  });

  it('stringifies cell values defensively per type', () => {
    expect(teamlyValueToString('hello', 'text')).toBe('hello');
    expect(teamlyValueToString(42, 'number')).toBe('42');
    expect(teamlyValueToString(true, 'checkbox')).toBe('true');
    expect(teamlyValueToString(false, 'checkbox')).toBe('false');
    expect(teamlyValueToString({ from: '2025-01-02T00:00:00', to: null }, 'date')).toBe('2025-01-02');
    expect(teamlyValueToString({ url: 'http://x.ru', title: 'X' }, 'url')).toBe('http://x.ru');
    const opts = [{ id: 'o1', text: 'Активен' }, { id: 'o2', text: 'Архив' }];
    expect(teamlyValueToString('o1', 'select', opts)).toBe('Активен');
    expect(teamlyValueToString(['o1', 'o2'], 'multi-select', opts)).toBe('Активен, Архив');
    expect(teamlyValueToString([{ fullName: 'Иван Иванов' }], 'person')).toBe('Иван Иванов');
    expect(teamlyValueToString([{ name: 'Пётр', surname: 'Петров' }], 'person')).toBe('Пётр Петров');
    // a `{ value: X }` envelope is unwrapped
    expect(teamlyValueToString({ value: 'wrapped' }, 'text')).toBe('wrapped');
    expect(teamlyValueToString(null, 'text')).toBe('');
    expect(teamlyValueToString(undefined, 'number')).toBe('');
  });

  it('resolves select/multi-select when the value arrives as an option OBJECT, not a bare id', () => {
    const opts = [{ id: 'o1', text: 'Активен' }, { id: 'o2', text: 'Архив' }];
    expect(teamlyValueToString({ id: 'o1', text: 'Активен' }, 'select', opts)).toBe('Активен');
    expect(teamlyValueToString([{ id: 'o1' }, { id: 'o2' }], 'multi-select', opts)).toBe('Активен, Архив');
    // an inline label survives even if the id isn't in options
    expect(teamlyValueToString({ id: 'oX', text: 'Прочее' }, 'select', opts)).toBe('Прочее');
  });

  it('optionLabels extracts distinct labels (text/label/value forms + JSON-string blob)', () => {
    expect(optionLabels([{ id: 'o1', text: 'A' }, { id: 'o2', label: 'B' }, { id: 'o3', value: 'C' }])).toEqual(['A', 'B', 'C']);
    expect(optionLabels('[{"id":"o1","text":"A"},{"id":"o2","text":"B"}]')).toEqual(['A', 'B']);
    expect(optionLabels(undefined)).toEqual([]);
  });

  it('propertyExternalId prefers propertyId, then id, then code', () => {
    expect(propertyExternalId({ propertyId: 'p', id: 'i', code: 'c' })).toBe('p');
    expect(propertyExternalId({ id: 'i', code: 'c' })).toBe('i');
    expect(propertyExternalId({ code: 'c' })).toBe('c');
    expect(propertyExternalId({})).toBeNull();
  });
});
