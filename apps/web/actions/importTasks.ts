'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@giper/db';
import { createTaskSchema } from '@giper/shared';
import { requireAuth } from '@/lib/auth';
import { canCreateTask } from '@/lib/permissions';
import { createTask } from '@/lib/tasks/createTask';
import { parseCsv } from '@/lib/import/parseCsv';

type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type ImportResult = {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
};

const MAX_ROWS = 500;
const TYPES = new Set(['TASK', 'BUG', 'FEATURE', 'EPIC', 'CHORE']);
const PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

/** Map a header cell to a known field key. */
function fieldOf(header: string): string {
  const h = header.trim().toLowerCase();
  if (['title', 'название', 'name'].includes(h)) return 'title';
  if (['description', 'описание', 'desc'].includes(h)) return 'description';
  if (['type', 'тип'].includes(h)) return 'type';
  if (['priority', 'приоритет'].includes(h)) return 'priority';
  if (['assignee', 'assignee_email', 'email', 'исполнитель'].includes(h)) return 'assignee';
  if (['due', 'duedate', 'due_date', 'срок', 'дедлайн'].includes(h)) return 'due';
  if (['estimate', 'estimatehours', 'estimate_hours', 'оценка'].includes(h)) return 'estimate';
  if (['tags', 'теги', 'метки'].includes(h)) return 'tags';
  return '';
}

/**
 * Bulk-create tasks in a project from CSV text. First row = header (column
 * names in RU or EN). `title` is required; type/priority are lenient (invalid
 * → default). Assignee is matched by email against project members (else left
 * unassigned). Each row is created via createTask, so numbering/automations/
 * webhooks all fire normally. Gated on task-create permission.
 */
export async function importTasksFromCsvAction(
  projectKey: string,
  csvText: string,
): Promise<ActionResult<ImportResult>> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: {
      id: true,
      ownerId: true,
      members: { select: { userId: true, user: { select: { email: true } } } },
    },
  });
  if (!project) return { ok: false, error: { code: 'NOT_FOUND', message: 'Проект не найден' } };
  if (!canCreateTask({ id: me.id, role: me.role }, project)) {
    return { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Недостаточно прав' } };
  }

  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нужна строка заголовков и хотя бы одна строка данных' } };
  }

  const header = rows[0]!.map(fieldOf);
  if (!header.includes('title')) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Нет колонки «title» (название)' } };
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_ROWS) {
    return { ok: false, error: { code: 'VALIDATION', message: `Слишком много строк (>${MAX_ROWS})` } };
  }

  // email → userId for assignee resolution (members + owner).
  const emailToId = new Map<string, string>();
  for (const m of project.members) {
    if (m.user.email) emailToId.set(m.user.email.toLowerCase(), m.userId);
  }

  const result: ImportResult = { created: 0, failed: 0, errors: [] };

  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r]!;
    const get = (key: string) => {
      const idx = header.indexOf(key);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    try {
      const rawType = get('type').toUpperCase();
      const rawPriority = get('priority').toUpperCase();
      const assigneeEmail = get('assignee').toLowerCase();
      const tagsCell = get('tags');
      const due = get('due');

      const input = createTaskSchema.parse({
        projectKey,
        title: get('title'),
        description: get('description') || undefined,
        type: TYPES.has(rawType) ? rawType : undefined,
        priority: PRIORITIES.has(rawPriority) ? rawPriority : undefined,
        assigneeId: assigneeEmail && emailToId.has(assigneeEmail) ? emailToId.get(assigneeEmail) : undefined,
        estimateHours: get('estimate') ? Number(get('estimate')) : undefined,
        dueDate: due || undefined,
        tags: tagsCell ? tagsCell.split(';').map((t) => t.trim()).filter(Boolean) : undefined,
      });

      await createTask(input, { id: me.id, role: me.role });
      result.created++;
    } catch (e) {
      result.failed++;
      const msg = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 160) : 'ошибка строки';
      result.errors.push({ row: r + 2, message: msg }); // +2: 1-based + header row
    }
  }

  revalidatePath(`/projects/${projectKey}/board`);
  revalidatePath(`/projects/${projectKey}/list`);
  return { ok: true, data: result };
}
