import { describe, it, expect } from 'vitest';
import { articleToDocx, type DocxTableData } from './articleToDocx';
import type { KbColumn, KbRow } from './getTables';

const col = (over: Partial<KbColumn> & Pick<KbColumn, 'id' | 'name' | 'type'>): KbColumn => ({
  options: null,
  relationTableId: null,
  formulaExpr: null,
  order: 0,
  ...over,
});

const SAMPLE = `# Заголовок

Параграф с **жирным**, *курсивом*, \`кодом\` и [ссылкой](https://example.com).

## Список
- первый
- второй
- [x] сделано
- [ ] не сделано

1. раз
2. два

> цитата

\`\`\`js
const x = 1;
\`\`\`

:::info
Это важная заметка.
:::

:::details Скрытое
секрет
:::

| A | B |
| - | - |
| 1 | 2 |

---

[[table:tbl1]]
`;

const tables: Record<string, DocxTableData> = {
  tbl1: {
    name: 'Реестр',
    columns: [
      col({ id: 'c1', name: 'Цена', type: 'NUMBER' }),
      col({ id: 'c2', name: 'Кол-во', type: 'NUMBER' }),
      col({ id: 'c3', name: 'Сумма', type: 'FORMULA', formulaExpr: '{Цена} * {Кол-во}' }),
    ],
    rows: [{ id: 'r1', order: 0, values: { c1: '100', c2: '3' } } as KbRow],
    relations: {},
  },
};

const isZip = (buf: Buffer) => buf.length > 2 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"

describe('articleToDocx', () => {
  it('produces a valid .docx buffer for the full markdown grammar + embedded table', async () => {
    const buf = await articleToDocx({ title: 'Документ', content: SAMPLE }, tables);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(isZip(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('handles empty content (title-only document)', async () => {
    const buf = await articleToDocx({ title: 'Пусто', content: '' }, {});
    expect(isZip(buf)).toBe(true);
  });

  it('renders a missing embed as a placeholder without throwing', async () => {
    const buf = await articleToDocx({ title: 'X', content: '[[table:nope]]' }, {});
    expect(isZip(buf)).toBe(true);
  });
});
