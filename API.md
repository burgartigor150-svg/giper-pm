# API.md

## Принципы

- **Server Actions** для всего, что вызывается изнутри Next.js приложения
- **REST API** только для внешних клиентов (агент, расширение, бот, webhooks)
- Все входы валидируются Zod-схемами из `packages/shared/schemas/`
- Все ответы — JSON, ошибки — RFC 7807 problem+json
- Все защищённые endpoints — Bearer token (для агента) или session cookie (для веба)

---

## REST API

### Base URL

`https://<host>/api`

### Авторизация

| Endpoint group        | Метод авторизации                              |
|-----------------------|------------------------------------------------|
| `/api/agent/*`        | `Authorization: Bearer <agent-token>`          |
| `/api/webhooks/*`     | Signature header (per-integration)             |
| `/api/internal/*`     | `Authorization: Bearer <internal-token>`       |
| `/api/public/*`       | NextAuth session cookie                        |

Agent token = SHA-256(deviceToken). Сравнивается с `AgentDevice.authToken`.

### Endpoints для агента

#### POST `/api/agent/pair`
Регистрирует новое устройство. Вызывается при первом запуске агента.

Request:
```json
{
  "pairingCode": "AGENT-X7K2",
  "deviceName": "MacBook Pro Игоря",
  "deviceKind": "DESKTOP_AGENT",
  "os": "darwin",
  "osVersion": "15.2",
  "appVersion": "1.0.0"
}
```

Response 200:
```json
{
  "deviceId": "ckxxx...",
  "authToken": "<long-token-store-locally>",
  "userId": "ckyyy..."
}
```

#### POST `/api/agent/heartbeat`
Раз в минуту. Подтверждает онлайн.

Request: пусто (auth header достаточно).

Response 200: `{ "ok": true, "serverTime": "2026-05-06T10:00:00Z" }`.

#### POST `/api/agent/activity`
Батч-загрузка активности. Раз в 5 минут.

Request:
```json
{
  "samples": [
    {
      "capturedAt": "2026-05-06T10:00:00Z",
      "durationSec": 30,
      "appName": "Code",
      "windowTitle": "schema.prisma — giper-pm",
      "url": null,
      "domain": null,
      "idleSeconds": 0
    },
    ...
  ]
}
```

Response 200:
```json
{ "accepted": 120, "rejected": 0 }
```

Сервер:
1. Проверяет `UserConsent[type=WINDOW_TRACKING]`. Если нет — отбрасывает всё.
2. Прогоняет через категоризацию (см. INTEGRATIONS.md)
3. Пытается смапить на задачу
4. Сохраняет в `Activity`
5. Обновляет `AgentDevice.lastSeenAt`

#### POST `/api/agent/screenshot`
Загрузка скриншота. Только при `UserConsent[type=SCREENSHOTS]`.

Multipart form:
- `capturedAt`: ISO datetime
- `image`: PNG file
- `blurred`: bool

Response 200: `{ "id": "ckxxx...", "expiresAt": "2026-06-05T10:00:00Z" }`

#### POST `/api/agent/timer/start`
Старт live-таймера на задачу.

Request:
```json
{ "taskId": "ckxxx...", "note": "fixing bug" }
```

Response 200:
```json
{ "timerId": "ckyyy...", "startedAt": "2026-05-06T10:00:00Z" }
```

Если у юзера уже есть незавершённый таймер — он автостопится первым.

#### POST `/api/agent/timer/stop`
Стоп текущего таймера.

Request:
```json
{ "note": "done with this part" }
```

Response 200:
```json
{
  "timerId": "ckyyy...",
  "startedAt": "2026-05-06T10:00:00Z",
  "endedAt": "2026-05-06T10:30:00Z",
  "durationMin": 30
}
```

### Endpoints для webhooks

#### POST `/api/webhooks/github`

Headers:
- `X-GitHub-Event`: тип события
- `X-Hub-Signature-256`: HMAC-SHA256 от body, ключ — `webhookSecret` интеграции

См. INTEGRATIONS.md → GitHub.

Response 200: `{ "ok": true }` — даже если событие не релевантно. Не возвращаем 4xx GitHub-у, чтобы он не ретраил.

#### POST `/api/webhooks/bitrix24`
См. INTEGRATIONS.md → Bitrix24.

#### POST `/api/webhooks/slack`
Сначала URL verification (`type: 'url_verification'` → возвращаем `challenge`).
Дальше — `event_callback`.

#### POST `/api/webhooks/telegram`
Telegram webhook (alternative to long polling).

### Endpoints для расширения

То же что и для агента, отдельно `/api/agent/activity` принимает source=`browser`.
Различается по `AgentDevice.kind`.

---

## Server Actions

Лежат в `apps/web/actions/`. Каждая — экспорт `async function` с `"use server"`.

### Конвенция

```ts
"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@giper/db";
import { revalidatePath } from "next/cache";

const Input = z.object({
  taskId: z.string().cuid(),
  status: z.nativeEnum(TaskStatus),
});

export async function changeTaskStatus(rawInput: unknown) {
  const session = await auth();
  if (!session) throw new Error("UNAUTHORIZED");
  
  const input = Input.parse(rawInput);
  
  // 1. Authorization (can this user change this task?)
  // 2. Domain logic (call use-case from lib/)
  // 3. Side effects (notifications, audit log)
  // 4. revalidatePath / revalidateTag
  
  return { ok: true };
}
```

### Список (минимум для MVP)

#### Auth & users
- `inviteUser(email, role)`
- `updateUserProfile(input)`
- `setHourlyRate(userId, rate)`
- `revokeUserAccess(userId)`

#### Projects
- `createProject(input)`
- `updateProject(projectId, input)`
- `archiveProject(projectId)`
- `addProjectMember(projectId, userId, role)`
- `removeProjectMember(projectId, userId)`

#### Tasks
- `createTask(input)`
- `updateTask(taskId, input)`
- `changeTaskStatus(taskId, status)`
- `assignTask(taskId, userId)`
- `addComment(taskId, body)`
- `deleteTask(taskId)`

#### Time
- `startTimer(taskId, note?)`
- `stopTimer(note?)`
- `logTimeManually(input)`  // для формы ручного ввода
- `editTimeEntry(entryId, input)`
- `deleteTimeEntry(entryId)`

#### Reports
- `getDailyDashboard(date?)`
- `getProjectTimeReport(projectId, from, to)`
- `getTeamWorkload(from, to)`
- `exportReportCsv(input)`

#### Consents
- `grantConsent(type)`
- `revokeConsent(type)`
- `requestDataExport()`  // GDPR-export всех своих данных
- `requestDataDeletion()` // GDPR-erasure

---

## Error format

Все ошибки в JSON-формате RFC 7807:

```json
{
  "type": "https://giper-pm/errors/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "taskId is required",
  "instance": "/api/agent/timer/start",
  "errors": [
    { "path": ["taskId"], "message": "Required" }
  ]
}
```

Server Actions кидают типизированные ошибки:

```ts
class DomainError extends Error {
  constructor(public code: string, public httpStatus = 400, message?: string) {
    super(message ?? code);
  }
}

throw new DomainError("TASK_NOT_FOUND", 404);
throw new DomainError("INSUFFICIENT_PERMISSIONS", 403);
throw new DomainError("CONCURRENT_TIMER", 409, "У юзера уже есть активный таймер");
```

Клиент через `next-safe-action` (или свою тонкую обёртку) обрабатывает их типобезопасно.

---

## Versioning

API внутренний, версионирование пока не нужно. Если потребуется внешний API
для клиентов — заводим `/api/v1/...`.
