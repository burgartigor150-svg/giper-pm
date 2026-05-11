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

import { isVertexEnabled, vertexJson } from './vertex';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'qwen2.5:14b';
const REQUEST_TIMEOUT_MS = Number(process.env.LLM_REQUEST_TIMEOUT_MS) > 0 ? Number(process.env.LLM_REQUEST_TIMEOUT_MS) : 600_000;
// Force Ollama to actually use Qwen's 32k+ context. Without this it
// silently truncates the prompt to the model's default num_ctx (4k).
const NUM_CTX = Number(process.env.LLM_NUM_CTX) > 0 ? Number(process.env.LLM_NUM_CTX) : 32_768;
const MAX_INPUT_BYTES = 80_000;
const MAX_INPUT_MESSAGES = 400;

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
  /**
   * Raw first-name/diminutive lifted from the source ("Катя",
   * "Сергей"). Set when the source explicitly addresses someone
   * but we don't know which real user to bind to (the org has
   * many Катя's; auto-match would misroute work). UI shows a
   * candidates picker so the human disambiguates. null when no
   * person was mentioned by name.
   */
  mentionedAssigneeName: string | null;
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
          mentionedAssigneeName: { type: ['string', 'null'] },
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
          'mentionedAssigneeName',
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
  // Prefer Vertex AI / Gemini when configured — much faster + frees
  // the local GPU for WhisperX. Falls back to Ollama otherwise.
  if (isVertexEnabled()) {
    const obj = await vertexJson({
      system: systemPrompt,
      user: userPrompt,
      schema: RESPONSE_SCHEMA as unknown as Parameters<typeof vertexJson>[0]['schema'],
      temperature: 0.2,
      maxOutputTokens: 8192,
    });
    return obj ? JSON.stringify(obj) : '';
  }

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
        // Ollama-specific: extends context window for this call. Other
        // OpenAI-compatible servers ignore unknown fields.
        options: { num_ctx: NUM_CTX },
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
  // mentionedAssigneeName is optional in older proposals (and the
  // TG-chat prompt doesn't ask for it). Trim+slice when present, else
  // default null. Cap at 80 chars — anything longer isn't a name.
  const mentioned =
    typeof p.mentionedAssigneeName === 'string' && p.mentionedAssigneeName.trim()
      ? p.mentionedAssigneeName.trim().slice(0, 80)
      : null;
  return {
    title: p.title.trim().slice(0, 220),
    description: p.description.trim().slice(0, 4000),
    type: allowedTypes.includes(p.type) ? p.type : 'TASK',
    priority: allowedPrio.includes(p.priority) ? p.priority : 'MEDIUM',
    suggestedAssigneeId: typeof p.suggestedAssigneeId === 'string' ? p.suggestedAssigneeId : null,
    mentionedAssigneeName: mentioned,
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

/**
 * Meeting-specific prompt. Differences from the TG-chat flow above:
 *  - the LLM is told the source is a SPOKEN meeting transcript, not
 *    a typed chat — "болтовни" filter is much stricter for chats
 *    than for meetings, where every word was deliberate
 *  - explicit instruction: report the mentioned name verbatim
 *    ("Катя", "Сергей") in mentionedAssigneeName but do NOT guess
 *    suggestedAssigneeId from a first name alone — in a 600-person
 *    company there are many Катя's. The UI lets the human pick.
 *  - suggestedAssigneeId is only set when the upstream uses a UNIQUE
 *    identifier (full name "Екатерина Иванова", or speaker label that
 *    maps 1:1 to a member id).
 *  - one-speaker meetings still produce proposals — a PM dictating
 *    today's plan is the most useful case for this feature
 */
const MEETING_SYSTEM_PROMPT = `Ты — ассистент проектного менеджера. На вход — транскрипт рабочей встречи (русский, разбит по репликам с тайм-кодами). Преврати его в список конкретных задач для трекера.

Жёсткие правила:
- Это запись живого разговора, а не чат. Каждая фраза была сказана осознанно — НЕ фильтруй её как "болтовню".
- Любое явное поручение ("Кате проверить маркетплейсы", "Сергею сделать ревью") — это задача. Эмити её.
- Один говорящий, раздающий задания нескольким людям, — нормальный кейс. Не сворачивай его в одну задачу.
- Назначение исполнителя:
  * mentionedAssigneeName: ВСЕГДА выпиши имя так, как оно прозвучало ("Катя", "Сергей", "Леонид"). Если по имени не назвали — null.
  * suggestedAssigneeId: НИКОГДА не выбирай члена проекта только по совпадению короткого имени ("Катя"). В компании может быть много Кать. Ставь id из members ТОЛЬКО если в речи прозвучало полное ФИО или иной уникальный идентификатор, и оно однозначно совпадает с одним участником. В остальных случаях — null. PM сам выберет нужного человека через UI.
- Заголовок — короткое императивное действие ("Проверить маркетплейсы", не "Маркетплейсы").
- Описание — 1-2 предложения по сути + дословная цитата ключевой реплики ([тайм-код] говорящий: ...). НЕ дублируй имя исполнителя в текст — оно уже в mentionedAssigneeName.
- Срок: если в речи сказано "сегодня"/"к завтра"/etc — переведи в YYYY-MM-DD относительно today из контекста. Если не сказано — null.
- Тип: BUG если жалоба/проблема ("этикетки не печатаются"), FEATURE если новый функционал, CHORE для рутины (документация, ревью), TASK для всего остального.
- Приоритет: URGENT для "горит/срочно", HIGH если есть короткий дедлайн, MEDIUM по умолчанию, LOW для отдалённых тем.
- В sourceMessageIds укажи id всех реплик (сегментов), которые легли в задачу. Минимум 1, максимум 5.
- Лучше пропустить, чем выдумывать. Если поручений нет (общение про погоду, представление участников) — верни {"proposals": []}.
- Отвечай СТРОГО валидным JSON по заданной схеме. Никакого текста вне JSON. Никаких комментариев.`;

function buildMeetingUserPrompt(
  messages: ChatMessageInput[],
  project: ProjectContext,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const membersBlock = project.members.length
    ? project.members.map((m) => `- ${m.id} → ${m.name}`).join('\n')
    : '(участников в проекте нет — все исполнители из транскрипта будут с suggestedAssigneeId=null)';
  const messagesBlock = messages.length
    ? messages
        .map((m) => `[id=${m.id}] [${m.timestamp}] ${m.author}: ${m.text}`)
        .join('\n')
    : '(сегменты не предоставлены)';
  return [
    `Сегодня: ${today}`,
    `Проект: ${project.key} — ${project.name}`,
    `Участники проекта (id → имя):`,
    membersBlock,
    ``,
    `Транскрипт встречи (хронологически, сверху вниз):`,
    messagesBlock,
    ``,
    `Верни JSON-объект {"proposals": [...]} с массивом задач по правилам выше.`,
    `Если поручений нет — верни {"proposals": []}.`,
  ].join('\n');
}

/**
 * Same shape as `proposeTasks` but with meeting-tuned prompt and a
 * fuzzy-match post-processor: after the LLM returns we try to attach
 * an assigneeId by matching mentions in description ("Катя …") against
 * member.name. This salvages cases where the LLM correctly identified
 * a person from a one-word reference but couldn't pick a member id
 * because the project member's name is fuller (e.g. "Екатерина
 * Иванова").
 */
export async function proposeTasksFromMeeting(
  messages: ChatMessageInput[],
  project: ProjectContext,
): Promise<ProposeResult> {
  if (!messages.length) {
    return { ok: true, proposals: [], usedMessages: 0, truncated: false };
  }
  const { trimmed, truncated } = trimMessages(messages);
  const userPrompt = buildMeetingUserPrompt(trimmed, project);
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callLlm(MEETING_SYSTEM_PROMPT, userPrompt);
      const proposals = tryParseProposals(raw);
      const knownIds = new Set(trimmed.map((m) => m.id));
      const memberIds = new Set(project.members.map((m) => m.id));
      const safe = proposals
        .map((p) => ({
          ...p,
          sourceMessageIds: p.sourceMessageIds.filter((id) => knownIds.has(id)),
        }))
        // For meeting transcripts we DON'T require sourceMessageIds — the
        // LLM is allowed to summarize across the whole transcript, and a
        // proposal with zero exact-match ids is still useful (a missing
        // id just means we won't auto-mark a segment as "harvested").
        ;
      for (const p of safe) {
        if (p.suggestedAssigneeId && !memberIds.has(p.suggestedAssigneeId)) {
          p.suggestedAssigneeId = null;
        }
      }
      return {
        ok: true,
        proposals: safe,
        usedMessages: trimmed.length,
        truncated,
      };
    } catch (e) {
      lastErr = e;
      // eslint-disable-next-line no-console
      console.warn(`[aiHarvest:meeting] attempt ${attempt + 1} failed`, e);
    }
  }
  return {
    ok: false,
    message: lastErr instanceof Error ? lastErr.message : 'LLM call failed',
  };
}

/**
 * Russian diminutive ↔ full-name table. Used by candidate search
 * (server-side action `searchUsersByMentionedName`) to fan out from
 * "Катя" → users whose name starts with "Екатерина", etc.
 *
 * We deliberately keep this in a static table rather than using a
 * Levenshtein / phonetic matcher. In a 600-person org any heuristic
 * fuzziness misroutes work more often than it helps. The table
 * encodes hard linguistic equivalences only.
 */
export const RUSSIAN_DIMINUTIVES: Array<[RegExp, string[]]> = [
  [/^Екатерина/i, ['Катя', 'Катюша']],
  [/^Александр/i, ['Саша', 'Шура', 'Алекс']],
  [/^Александра/i, ['Саша', 'Шура', 'Аля']],
  [/^Алексей/i, ['Лёша', 'Леша', 'Алёша']],
  [/^Анастасия/i, ['Настя']],
  [/^Анна/i, ['Аня', 'Анюта']],
  [/^Антон/i, ['Антоша']],
  [/^Артём|^Артем/i, ['Тёма', 'Тема']],
  [/^Валентин/i, ['Валя']],
  [/^Валерий/i, ['Валера']],
  [/^Виктор/i, ['Витя']],
  [/^Виктория/i, ['Вика']],
  [/^Владимир/i, ['Вова', 'Володя']],
  [/^Дмитрий/i, ['Дима', 'Митя']],
  [/^Евгений/i, ['Женя']],
  [/^Евгения/i, ['Женя']],
  [/^Елена/i, ['Лена']],
  [/^Игорь/i, ['Игорёк']],
  [/^Ирина/i, ['Ира']],
  [/^Константин/i, ['Костя']],
  [/^Кирилл/i, ['Кир']],
  [/^Леонид/i, ['Лёня', 'Леня']],
  [/^Людмила/i, ['Люда', 'Мила']],
  [/^Мария/i, ['Маша']],
  [/^Михаил/i, ['Миша']],
  [/^Надежда/i, ['Надя']],
  [/^Наталья|^Наталия/i, ['Наташа', 'Ната']],
  [/^Николай/i, ['Коля']],
  [/^Ольга/i, ['Оля']],
  [/^Павел/i, ['Паша']],
  [/^Сергей/i, ['Серёжа', 'Серега']],
  [/^Татьяна/i, ['Таня']],
  [/^Юлия/i, ['Юля']],
  [/^Юрий/i, ['Юра']],
];

/**
 * Given a diminutive (e.g. "Катя"), return all full-name prefixes
 * that produce it (e.g. ["Екатерина"]). Used to expand a mentioned
 * name into the SQL `name STARTS WITH ?` set when searching for
 * candidate users. Returns the input itself too so "Сергей" stays
 * "Сергей" — full names also match through the same query.
 */
export function expandRussianName(name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const out = new Set<string>([trimmed]);
  for (const [fullPattern, dims] of RUSSIAN_DIMINUTIVES) {
    for (const d of dims) {
      if (d.toLowerCase() === trimmed.toLowerCase()) {
        // Recover the full-name prefix from the RegExp source. The
        // pattern is always anchored at ^; multi-alternative entries
        // (e.g. Наталья|Наталия) need splitting.
        const src = fullPattern.source.replace(/^\^/, '');
        for (const alt of src.split('|')) {
          const cleanAlt = alt.replace(/^\^/, '');
          if (cleanAlt) out.add(cleanAlt);
        }
      }
    }
  }
  return [...out];
}
