import { NextResponse } from 'next/server';
import { prisma, type TaskStatus } from '@giper/db';
import { resolveApiToken } from '@/lib/api/resolveApiToken';
import type { SessionUser } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { listProjectsForUser } from '@/lib/projects';
import { listTasksForBoard } from '@/lib/tasks/listTasksForBoard';
import { getTask } from '@/lib/tasks/getTask';
import { createTask } from '@/lib/tasks/createTask';
import { addComment } from '@/lib/tasks/addComment';
import { changeTaskStatus } from '@/lib/tasks/changeTaskStatus';
import { setInternalStatus } from '@/lib/tasks/setInternalStatus';

/**
 * Model Context Protocol (MCP) server for giper-pm over Streamable HTTP.
 * One JSON-RPC 2.0 endpoint; auth is the same `Authorization: Bearer gpm_…`
 * API token as the public REST API — every call runs with the token owner's
 * own visibility/permissions (the core lib fns enforce it).
 *
 * Connect from Claude Code:
 *   claude mcp add --transport http giper https://<host>/api/mcp \
 *     --header "Authorization: Bearer gpm_…"
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'giper-pm', version: '1.0.0' };

const STATUSES: TaskStatus[] = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'BLOCKED',
  'DONE',
  'CANCELED',
];

type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

const TOOLS: ToolDef[] = [
  {
    name: 'list_projects',
    description:
      'Список проектов, доступных пользователю (ключ, название, статус). Без аргументов.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_tasks',
    description:
      'Задачи проекта (видимые пользователю): номер, заголовок, статус (зеркальный и внутренний), приоритет, исполнитель.',
    inputSchema: {
      type: 'object',
      properties: { projectKey: { type: 'string', description: 'Ключ проекта, напр. GIPER' } },
      required: ['projectKey'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description:
      'Полная карточка задачи: описание, статусы, приоритет, исполнитель, теги, родитель, связанные PR/MR и последние комментарии.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        number: { type: 'integer', description: 'Номер задачи в проекте' },
      },
      required: ['projectKey', 'number'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description: 'Создать задачу в проекте. Возвращает её код (КЛЮЧ-НОМЕР).',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
        assigneeId: { type: 'string', description: 'ID пользователя-исполнителя (опц.)' },
      },
      required: ['projectKey', 'title'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_comment',
    description: 'Добавить комментарий к задаче.',
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        number: { type: 'integer' },
        body: { type: 'string' },
      },
      required: ['projectKey', 'number', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_status',
    description: `Сменить ЗЕРКАЛЬНЫЙ статус задачи (как в источнике). Допустимые: ${STATUSES.join(', ')}. Для зеркальных из Bitrix задач нельзя — используйте set_internal_status.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        number: { type: 'integer' },
        status: { type: 'string', enum: STATUSES },
      },
      required: ['projectKey', 'number', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_internal_status',
    description: `Сменить ВНУТРЕННИЙ (командной доски) статус задачи. Работает и на зеркальных из Bitrix задачах. Допустимые: ${STATUSES.join(', ')}. Учитывает правила рабочего процесса проекта.`,
    inputSchema: {
      type: 'object',
      properties: {
        projectKey: { type: 'string' },
        number: { type: 'integer' },
        status: { type: 'string', enum: STATUSES },
      },
      required: ['projectKey', 'number', 'status'],
      additionalProperties: false,
    },
  },
];

type Args = Record<string, unknown>;
const str = (a: Args, k: string): string => {
  const v = a[k];
  if (typeof v !== 'string' || !v.trim()) throw new DomainError('VALIDATION', 400, `Нужен параметр ${k}`);
  return v.trim();
};
const num = (a: Args, k: string): number => {
  const v = a[k];
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) throw new DomainError('VALIDATION', 400, `Нужен целочисленный ${k}`);
  return n;
};

async function runTool(name: string, args: Args, user: SessionUser): Promise<string> {
  switch (name) {
    case 'list_projects': {
      const projects = await listProjectsForUser(user);
      return JSON.stringify(
        projects.map((p) => ({ key: p.key, name: p.name, status: p.status })),
        null,
        2,
      );
    }
    case 'list_tasks': {
      const { project, tasks } = await listTasksForBoard(str(args, 'projectKey'), {}, user);
      return JSON.stringify(
        {
          project: { key: project.key, name: project.name },
          tasks: tasks.map((t) => ({
            ref: `${project.key}-${t.number}`,
            title: t.title,
            status: t.status,
            internalStatus: t.internalStatus,
            priority: t.priority,
            assignee: t.assignee?.name ?? null,
          })),
        },
        null,
        2,
      );
    }
    case 'get_task': {
      const key = str(args, 'projectKey');
      const n = num(args, 'number');
      const t = await getTask(key, n, user);
      const comments = await prisma.comment.findMany({
        where: { taskId: t.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { body: true, createdAt: true, author: { select: { name: true } } },
      });
      return JSON.stringify(
        {
          ref: `${key}-${t.number}`,
          title: t.title,
          description: t.description?.slice(0, 4000) ?? null,
          status: t.status,
          internalStatus: t.internalStatus,
          priority: t.priority,
          type: t.type,
          assignee: t.assignee?.name ?? null,
          tags: t.taskTags?.map((x) => x.tag.name) ?? [],
          parent: t.parent ? `${t.parent.project.key}-${t.parent.number}` : null,
          pullRequests: t.pullRequests.map((p) => ({
            provider: p.provider,
            ref: `${p.repo}${p.provider === 'gitlab' ? '!' : '#'}${p.number}`,
            state: p.state,
            url: p.url,
          })),
          recentComments: comments
            .reverse()
            .map((c) => ({ author: c.author?.name ?? '—', body: c.body.slice(0, 1000) })),
        },
        null,
        2,
      );
    }
    case 'create_task': {
      const projectKey = str(args, 'projectKey');
      const title = str(args, 'title');
      const created = await createTask(
        {
          projectKey,
          title,
          description: typeof args.description === 'string' ? args.description : undefined,
          priority: (args.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT') ?? undefined,
          assigneeId: typeof args.assigneeId === 'string' ? args.assigneeId : undefined,
          tags: [],
        },
        user,
      );
      return `Создана задача ${projectKey}-${created.number}: ${title}`;
    }
    case 'add_comment': {
      const key = str(args, 'projectKey');
      const t = await getTask(key, num(args, 'number'), user);
      await addComment(t.id, str(args, 'body'), user, { visibility: 'EXTERNAL' });
      return `Комментарий добавлен к ${key}-${t.number}`;
    }
    case 'set_status': {
      const key = str(args, 'projectKey');
      const status = str(args, 'status') as TaskStatus;
      if (!STATUSES.includes(status)) {
        throw new DomainError('VALIDATION', 400, `Недопустимый статус: ${status}`);
      }
      const t = await getTask(key, num(args, 'number'), user);
      await changeTaskStatus(t.id, status, user);
      return `Статус ${key}-${t.number} → ${status}`;
    }
    case 'set_internal_status': {
      const key = str(args, 'projectKey');
      const status = str(args, 'status');
      const t = await getTask(key, num(args, 'number'), user);
      await setInternalStatus(t.id, status, user);
      return `Внутренний статус ${key}-${t.number} → ${status}`;
    }
    default:
      throw new DomainError('VALIDATION', 400, `Неизвестный инструмент: ${name}`);
  }
}

type RpcReq = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown };

function rpcResult(id: RpcReq['id'], result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}
function rpcError(id: RpcReq['id'], code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

async function handleOne(msg: RpcReq, user: SessionUser): Promise<object | null> {
  // Notifications (no id) get no response.
  if (msg.id === undefined || msg.id === null) {
    return null;
  }
  switch (msg.method) {
    case 'initialize': {
      const requested = (msg.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: requested || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const p = (msg.params ?? {}) as { name?: string; arguments?: Args };
      if (!p.name) return rpcError(msg.id, -32602, 'Не указан name инструмента');
      try {
        const text = await runTool(p.name, p.arguments ?? {}, user);
        return rpcResult(msg.id, { content: [{ type: 'text', text }], isError: false });
      } catch (e) {
        const message =
          e instanceof DomainError ? e.message || e.code : e instanceof Error ? e.message : String(e);
        // Tool-level errors are reported in the result (isError), not as JSON-RPC errors.
        return rpcResult(msg.id, { content: [{ type: 'text', text: `Ошибка: ${message}` }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Метод не поддерживается: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  const user = await resolveApiToken(req);
  if (!user) {
    return NextResponse.json(
      rpcError(null, -32001, 'unauthorized: нужен Authorization: Bearer gpm_…'),
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'parse error'), { status: 400 });
  }

  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((m) => handleOne(m as RpcReq, user)))
    ).filter((r): r is object => r !== null);
    return responses.length === 0
      ? new Response(null, { status: 202 })
      : NextResponse.json(responses);
  }

  const res = await handleOne(body as RpcReq, user);
  return res === null ? new Response(null, { status: 202 }) : NextResponse.json(res);
}

/** GET is used by some clients to open an SSE stream — we only do request/response. */
export function GET() {
  return NextResponse.json(
    { ok: true, server: SERVER_INFO, transport: 'streamable-http', note: 'POST JSON-RPC here' },
    { status: 200 },
  );
}
