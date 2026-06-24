import type { KnowledgeColumnType } from '@giper/db';
import type { TeamlySchemaProperty, TeamlySpace } from './client';

/**
 * TEAMLY smart-table ("Умная таблица") mapping helpers. A TEAMLY table is a
 * space whose `schemaProperties` are the columns and whose articles are the
 * rows; each article's `properties.properties` holds the cell values keyed by
 * the property `code`. These pure helpers translate TEAMLY property types +
 * values into giper-pm's KnowledgeTable model (typed columns + string cells).
 *
 * Everything here is DEFENSIVE: the read-side value shapes aren't crisply
 * documented (only the write-side is), so each resolver tolerates the value
 * arriving bare OR wrapped in `{ value: ... }`, and unknown shapes degrade to a
 * readable string rather than throwing.
 */

/** System property codes dropped from a table's columns (kept: `title` = name). */
const SYSTEM_CODES = new Set(['author', 'executor', 'executionDate']);

/**
 * Codes TEAMLY exposes on EVERY space — including ordinary article spaces. The
 * API returns these system properties for plain spaces too, so a smart table is
 * detected by the presence of at least one USER-defined property BEYOND these.
 */
const SYSTEM_SCHEMA_CODES = new Set(['title', 'author', 'executor', 'executionDate']);

/**
 * Is this space a smart table? Only when it exposes a user-defined property (a
 * real column) — NOT merely the system props every space carries. A bare
 * `schemaProperties.length > 0` check misclassifies every article space as a
 * table (TEAMLY returns title/author/executor/executionDate on all spaces),
 * which would convert articles into table rows.
 */
export function isTableSpace(sp: TeamlySpace): boolean {
  return (sp.schemaProperties ?? []).some(
    (p) => !p.hide && !!p.code && !SYSTEM_SCHEMA_CODES.has(p.code),
  );
}

/** The columns to import: drop hidden + system-metadata properties, keep order. */
export function tableColumns(sp: TeamlySpace): TeamlySchemaProperty[] {
  const props = (sp.schemaProperties ?? []).filter(
    (p) => !p.hide && !(p.code && SYSTEM_CODES.has(p.code)),
  );
  return props.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/** TEAMLY property `type` → giper-pm KnowledgeColumnType (v1 subset). */
export function teamlyTypeToColumnType(type: string | undefined): KnowledgeColumnType {
  switch (type) {
    case 'number':
      return 'NUMBER';
    case 'date':
      return 'DATE';
    case 'checkbox':
      return 'CHECKBOX';
    case 'select':
    case 'multi-select':
      return 'SELECT';
    case 'url':
      return 'URL';
    // text | title | person | anything unknown → plain text
    default:
      return 'TEXT';
  }
}

/** Stable id for a schema property (column externalId). */
export function propertyExternalId(p: TeamlySchemaProperty): string | null {
  return p.propertyId || p.id || p.code || null;
}

type Variant = { id?: string; value?: string; text?: string; label?: string; title?: string };

/** Normalise a select/multi-select options blob into `[{id,label}]`. */
function variants(raw: unknown): Variant[] {
  if (Array.isArray(raw)) return raw as Variant[];
  if (typeof raw === 'string') {
    // Some ql fields arrive JSON-encoded (cf. proseMirror content) — parse + recurse.
    try {
      return variants(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (raw && typeof raw === 'object') {
    // Sometimes options come keyed by id: { "<id>": { text, ... }, ... }.
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.variants)) return obj.variants as Variant[];
    return Object.entries(obj).map(([id, v]) =>
      v && typeof v === 'object' ? { id, ...(v as object) } : { id, text: String(v) },
    );
  }
  return [];
}

/** Distinct option labels for a SELECT column (stored on KnowledgeTableColumn.options). */
export function optionLabels(raw: unknown): string[] {
  const out: string[] = [];
  for (const v of variants(raw)) {
    const label = v.label ?? v.text ?? v.title ?? v.value ?? v.id;
    if (label != null && !out.includes(String(label))) out.push(String(label));
  }
  return out;
}

/** Resolve one option id → its label via the property options. The value may
 * arrive as a bare id OR as the already-hydrated option object — handle both. */
function labelFor(id: unknown, raw: unknown): string {
  let key: unknown = id;
  let inline: unknown = null;
  if (id && typeof id === 'object') {
    const o = id as Variant;
    key = o.id ?? o.value ?? null;
    inline = o.text ?? o.label ?? o.title ?? null;
  }
  for (const v of variants(raw)) {
    if (v.id === key || v.value === key) return String(v.label ?? v.text ?? v.title ?? v.value ?? v.id);
  }
  if (inline != null) return String(inline);
  return key == null ? '' : String(key);
}

/** Unwrap a `{ value: X }` envelope (TEAMLY read values may or may not wrap). */
function unwrap(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as object)) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

function dateStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { from?: unknown; to?: unknown };
    const from = o.from != null ? String(o.from).slice(0, 10) : '';
    const to = o.to != null ? String(o.to).slice(0, 10) : '';
    return to && to !== from ? `${from} — ${to}` : from;
  }
  return String(v).slice(0, 10);
}

/**
 * One cell value → a display string for KnowledgeTableRow.values. `raw` is the
 * value at `article.properties.properties[code]`; `options` is the column's
 * select options blob.
 */
export function teamlyValueToString(
  raw: unknown,
  type: string | undefined,
  options?: unknown,
): string {
  const v = unwrap(raw);
  if (v == null) return '';
  switch (type) {
    case 'number':
      return typeof v === 'number' ? String(v) : String(v ?? '');
    case 'checkbox':
      return v === true || v === 'true' || v === 1 ? 'true' : 'false';
    case 'date':
      return dateStr(v);
    case 'url': {
      if (typeof v === 'object') {
        const o = v as { url?: unknown; title?: unknown };
        return String(o.url ?? o.title ?? '');
      }
      return String(v);
    }
    case 'select':
      return labelFor(v, options);
    case 'multi-select':
      return (Array.isArray(v) ? v : [v]).map((id) => labelFor(id, options)).filter(Boolean).join(', ');
    case 'person': {
      const arr = Array.isArray(v) ? v : [v];
      return arr
        .map((p) => {
          if (p && typeof p === 'object') {
            const o = p as { fullName?: string; name?: string; surname?: string };
            return o.fullName || [o.name, o.surname].filter(Boolean).join(' ') || '';
          }
          return String(p ?? '');
        })
        .filter(Boolean)
        .join(', ');
    }
    case 'text':
    case 'title':
    default:
      if (typeof v === 'string') return v;
      if (typeof v === 'object') {
        const o = v as { text?: unknown };
        if (o.text != null) return String(o.text);
        return JSON.stringify(v).slice(0, 2000);
      }
      return String(v);
  }
}
