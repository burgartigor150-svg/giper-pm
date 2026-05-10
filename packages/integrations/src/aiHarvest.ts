/**
 * AI-powered Telegram chat → tasks proposer.
 *
 * Uses a local OpenAI-compatible endpoint (Ollama with Qwen 2.5 14B by
 * default) — no external API keys, the chat history never leaves the
 * server. The model receives a project context (key, name, members) and
 * a list of recent messages, then groups them into proposed tasks with
 * title / description / type / priority and optional assignee + due
 * date. The web app shows the result in a modal where the PM picks
 * which proposals to actually create.
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:14b';
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_INPUT_BYTES = 50_000;
const MAX_INPUT_MESSAGES = 200;

export type ChatMessageInput = {
  /** TelegramProjectMessage.id — used by the model to link a proposal to source rows. */
  id: string;
  /** Telegram username (without @) or fallback display name. */
  author: string;
  /** ISO timestamp. */
  timestamp: string;
  text: string;
  hasAttachment: boolean;
};

export type ProjectContext = {
  key: string;
  name: string;
  members: { id: string; name: string }[];
};

export type TaskProposal = {
  title: string;
  description: string;
  type: 'TASK' | 'BUG' | 'FEATURE' | 'CHORE';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  /** User.id from ProjectContext.members or null. */
  suggestedAssigneeId: string | null;
  /** ISO date 'YYYY-MM-DD' or null. */
  suggestedDueDate: string | null;
  /** TelegramProjectMessage.id values that contributed to this task. */
  sourceMessageIds: string[];
  /** 1-2 sentence rationale shown to the PM as a hint. */
  rationale: string;
};

export type ProposeResult =
  | { ok: true; proposals: TaskProposal[]; usedMessages: number; truncated: boolean }
  | { ok: false; message: string };

function llmConfig() {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: process.env.LLM_MODEL?.trim() || DEFAULT_MODEL,
  };
}

/**
 * Trim the message list so the prompt stays under MAX_INPUT_BYTES / MAX_INPUT_MESSAGES.
 * Drops oldest messages first (keeps the tail = most recent context).
 */
function trimMessages(messages: ChatMessageInput[]): { trimmed: ChatMessageInput[]; truncated: boolean } {
  let bytes = 0;
  const reversed = [...messages].reverse();
  const kept: ChatMessageInput[] = [];
  let truncated = false;
  for (const m of reversed) {
    const size = (m.author?.length ?? 0) + (m.text?.length ?? 0) + 40;
    if (kept.length >= MAX_INPUT_MESSAGES || bytes + size > MAX_INPUT_BYTES) {
      truncated = true;
      break;
    }
    bytes += size;
    kept.push(m);
  }
  return { trimmed: kept.reverse(), truncated };
}

const SYSTEM_PROMPT = `Ты — ассистент проектного менеджера. На вход получаешь сырой лог сообщений из рабочего Telegram-чата команды и должен превратить его в осмысленный список задач для трекера.

Жёсткие правила:
- Игнорируй болтовню, благодарности, согласия ("ок", "понял", "спасибо", "до завтра", "пока"), стикеры/эмодзи без смысла.
- Группируй связанные сообщения в ОДНУ задачу. Несколько реплик про один баг = одна задача.
- Если из чата непонятно, что делать — лучше пропусти, чем выдумывай.
- Не создавай задачи на каждое сообщение, не плоди шум. Лучше 2 хороших задачи, чем 10 плохих.
- Заголовок — короткое императивное действие ("Починить экспорт в xlsx", не "Экспорт в xlsx сломался").
- Описание — 1-3 предложения по сути + цитата ключевых сообщений из чата (со ссылкой на автора).
- Если в чате упомянули срок ("к среде", "до конца недели", "завтра") — переведи в YYYY-MM-DD относительно today, который тебе дадут в контексте.
- Если упомянут конкретный участник как ответственный ("Петя сделает") — поставь его id из members в suggestedAssigneeId. Если такого нет — null.
- Тип: BUG если жалоба/ошибка/не работает, FEATURE если просьба нового функционала, CHORE для рутины (документация, чистка), TASK для всего остального.
- Приоритет: URGENT если "горит", "срочно", "клиент жалуется"; HIGH если есть дедлайн в течение 3 дней; MEDIUM по умолчанию; LOW для "когда-нибудь".
- В sourceMessageIds укажи id всех сообщений из чата, которые легли в эту задачу.
- Отвечай СТРОГО валидным JSON по заданной схеме. Никакого текста вне JSON. Никаких комментариев в JSON.`;

function buildUserPrompt(messages: ChatMessageInput[], project: ProjectContext): string {
  const today = new Date().toISOString().slice(0, 10);
  const membersBlock = project.members.length
    ? project.members.map((m) => `- ${m.id} → ${m.name}`).join('\n')
    : '(участников проекта нет)';
  const messagesBlock = messages.length
    ? messages
        .map((m) => {
          const tag = m.hasAttachment ? ' [есть вложение]' : '';
          return `[id=${m.id}] [${m.timestamp}] ${m.author}:${tag} ${m.text}`;
        })
        .join('\n')
    : '(сообщений нет)';
  return [
    `Сегодня: ${today}`,
    `Проект: ${project.key} — ${project.name}`,
    `Участники проекта (id → имя):`,
    membersBlock,
    ``,
    `Сообщения из Telegram-чата (хронологически, сверху вниз):`,
    messagesBlock,
    ``,
    `Верни JSON-объект {"proposals": [...]}`,
    `с массивом задач по правилам выше. Если в чате нет ничего стоящего — верни {"proposals": []}.`,
  ].join('\n');
}

/**
 * JSON Schema for response_format. Ollama (and most OpenAI-compat servers)
 * accept this format and constrain decoding to match.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string', enum: ['TASK', 'BUG', 'FEATURE', 'CHORE'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          suggestedAssigneeId: { type: ['string', 'null'] },
          suggestedDueDate: { type: ['string', 'null'] },
          sourceMessageIds: { type: 'array', items: { type: 'string' } },
          rationale: { type: 'string' },
        },
        required: [
          'title',
          'description',
          'type',
          'priority',
          'suggestedAssigneeId',
          'suggestedDueDate',
          'sourceMessageIds',
          'rationale',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
} as const;

async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const { baseUrl, model } = llmConfig();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object', schema: RESPONSE_SCHEMA },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM returned empty content');
    return content;
  } finally {
    clearTimeout(t);
  }
}

function tryParseProposals(raw: string): TaskProposal[] {
  // Some models prefix with markdown fence even when asked for JSON.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`);
  }
  const proposals =
    parsed && typeof parsed === 'object' && 'proposals' in parsed
      ? (parsed as { proposals: unknown }).proposals
      : null;
  if (!Array.isArray(proposals)) {
    throw new Error('LLM payload missing proposals[] array');
  }
  return proposals.filter(isValidProposal).map(normalizeProposal);
}

function isValidProposal(p: unknown): p is TaskProposal {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.title === 'string' &&
    typeof o.description === 'string' &&
    typeof o.type === 'string' &&
    typeof o.priority === 'string' &&
    Array.isArray(o.sourceMessageIds) &&
    typeof o.rationale === 'string'
  );
}

function normalizeProposal(p: TaskProposal): TaskProposal {
  const allowedTypes: TaskProposal['type'][] = ['TASK', 'BUG', 'FEATURE', 'CHORE'];
  const allowedPrio: TaskProposal['priority'][] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
  const dueDate =
    p.suggestedDueDate && /^\d{4}-\d{2}-\d{2}$/.test(p.suggestedDueDate)
      ? p.suggestedDueDate
      : null;
  return {
    title: p.title.trim().slice(0, 220),
    description: p.description.trim().slice(0, 4000),
    type: allowedTypes.includes(p.type) ? p.type : 'TASK',
    priority: allowedPrio.includes(p.priority) ? p.priority : 'MEDIUM',
    suggestedAssigneeId: typeof p.suggestedAssigneeId === 'string' ? p.suggestedAssigneeId : null,
    suggestedDueDate: dueDate,
    sourceMessageIds: p.sourceMessageIds
      .filter((x): x is string => typeof x === 'string')
      .slice(0, 50),
    rationale: p.rationale.trim().slice(0, 500),
  };
}

export async function proposeTasks(
  messages: ChatMessageInput[],
  project: ProjectContext,
): Promise<ProposeResult> {
  if (!messages.length) {
    return { ok: true, proposals: [], usedMessages: 0, truncated: false };
  }
  const { trimmed, truncated } = trimMessages(messages);
  const userPrompt = buildUserPrompt(trimmed, project);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callLlm(SYSTEM_PROMPT, userPrompt);
      const proposals = tryParseProposals(raw);
      // Strip proposals whose source ids don't match any provided message
      // (model sometimes hallucinates ids).
      const knownIds = new Set(trimmed.map((m) => m.id));
      const safe = proposals
        .map((p) => ({
          ...p,
          sourceMessageIds: p.sourceMessageIds.filter((id) => knownIds.has(id)),
        }))
        .filter((p) => p.sourceMessageIds.length > 0);
      // Same for assignee id.
      const memberIds = new Set(project.members.map((m) => m.id));
      for (const p of safe) {
        if (p.suggestedAssigneeId && !memberIds.has(p.suggestedAssigneeId)) {
          p.suggestedAssigneeId = null;
        }
      }
      return { ok: true, proposals: safe, usedMessages: trimmed.length, truncated };
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(`[aiHarvest] attempt ${attempt + 1} failed`, e);
    }
  }
  return {
    ok: false,
    message: lastErr instanceof Error ? lastErr.message : 'LLM call failed',
  };
}
