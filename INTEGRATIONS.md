# INTEGRATIONS.md

Унифицированные спеки на интеграции с внешними системами.

## Общий интерфейс

Каждая интеграция в `packages/integrations/<kind>/` экспортирует:

```ts
export interface Integration {
  kind: IntegrationKind;
  setup(config: unknown): Promise<void>;
  syncIn?(integration: IntegrationRecord): Promise<SyncResult>;
  syncOut?(event: DomainEvent): Promise<void>;
  webhookHandler?: WebhookHandler;
}

export type DomainEvent =
  | { type: 'task.created'; task: Task }
  | { type: 'task.updated'; before: Task; after: Task }
  | { type: 'task.commented'; task: Task; comment: Comment }
  | { type: 'time.logged'; entry: TimeEntry };
```

Все интеграции регистрируются в `packages/integrations/registry.ts`.

---

## GitHub / GitLab

### Что делает
- Webhook слушает: `push`, `pull_request`, `pull_request_review`, `issue_comment`
- Парсит ID задач из commit messages, branch names, PR titles
- Создаёт `Comment` в задаче со ссылкой на коммит/PR
- Опционально: меняет статус задачи (PR opened → REVIEW, merged → DONE)
- Создаёт `TimeEntry` source=`DIGITAL_GIT` для эвристической сверки

### Парсинг ID задач

Регексп: `\b([A-Z]{2,5})-(\d+)\b` — например `GFM-42`, `OPS-101`.

Места поиска (в порядке приоритета):
1. PR title
2. Branch name (`feature/GFM-42-add-login` → GFM-42)
3. Commit message (первая строка)
4. PR description body

Один коммит может линковаться к нескольким задачам (например `Fix GFM-42, GFM-43`).

### Webhook setup

```
URL:    https://<host>/api/webhooks/github
Secret: <ProjectIntegration.config.webhookSecret>
Events: push, pull_request, pull_request_review, issue_comment
```

### Эвристика для DIGITAL_GIT TimeEntry

```
push of N commits referencing TASK-X
  → TimeEntry { taskId: X, durationMin: N * 30, source: DIGITAL_GIT }

PR opened referencing TASK-X
  → TimeEntry { taskId: X, durationMin: 60, source: DIGITAL_GIT }

PR review submitted on PR referencing TASK-X
  → TimeEntry { user: reviewer, taskId: X, durationMin: 20, source: DIGITAL_GIT }
```

Эти entries — **слабый сигнал**, не используется в биллинге, только в сверке.

### Конфигурация на уровне проекта

```ts
ProjectIntegration.config = {
  repo: 'giper-fm/website',          // owner/repo
  webhookSecret: '...',
  autoStatusOnPR: true,              // менять статус задачи?
  branchPattern: '\\b[A-Z]+-\\d+\\b' // регексп для парсинга ветки
}
```

---

## Bitrix24

### Что делает
- Двусторонний синк задач (Bitrix24 ↔ giper-pm)
- Bitrix как источник правды для проектов с клиентами giper.fm
- Комментарии и статусы синкаются в обе стороны

### Auth
OAuth 2.0 на уровне аккаунта компании. Tokens — в `Integration.config`.
Webhook URL для входящих событий настраивается в Bitrix вручную.

### Маппинг

| Bitrix24            | giper-pm        |
|---------------------|-----------------|
| Group/Project       | Project         |
| Task                | Task            |
| Task Stages         | TaskStatus      |
| Comments            | Comment         |
| Responsible         | assigneeId      |
| Auditors            | tags?           |

Маппинг стадий настраивается в `ProjectIntegration.config.stageMapping`.

### Sync
- Polling каждые 5 мин если webhook не настроен
- При webhook — реактивно
- Защита от циклов: `externalId` + флаг «не уведомлять источник»

---

## Telegram

См. **отдельную секцию в ROADMAP** Фаза 2. Но коротко по архитектуре:

### Pairing
1. Юзер в вебе на /settings/integrations жмёт «Подключить TG»
2. Генерируется код вида `TG-A4F2K9`, action в боте `/start TG-A4F2K9`
3. Бот находит User по коду, сохраняет `tgChatId`
4. Код одноразовый, протухает за 5 минут

### Команды

| Команда                    | Действие                                      |
|----------------------------|-----------------------------------------------|
| `/start`                   | приветствие + инструкции                      |
| `/start <code>`            | pairing                                       |
| `/start <task>`            | старт таймера на задачу                       |
| `/stop [comment]`          | стоп текущего таймера                         |
| `/today`                   | часы за сегодня                               |
| `/week`                    | часы за неделю                                |
| `/log <dur> <task> <note>` | ручной лог (`/log 2h GFM-42 fixed bug`)       |
| `/pause`, `/resume`        | пауза текущего таймера                        |
| `/me`                      | мой статус: текущая задача и часы             |
| `/help`                    | список команд                                 |

### Pushes (исходящие из бота)

- 18:00 локально — «Подтверди вчерашние X.Y часов?» с inline-кнопками да/нет/исправить
- При assignment задачи — «Тебе назначена GFM-42: …»
- Утренний дайджест PM-у в 9:00 — «Команда вчера: 47ч; в просрочке: 3 задачи»

---

## Google Calendar

### Что делает
- OAuth доступ к календарю сотрудника (по согласию `CALENDAR_SYNC`)
- Раз в час подтягивает встречи за следующие 7 дней
- Создаёт `TimeEntry` source=`DIGITAL_CALENDAR`, category=`MEETING`
- Если в названии события или описании есть `TASK-X` — линкует к задаче

### Эвристика

```
Если событие в рабочее время (settings.workHours) И длительность > 15 мин:
  → создаётся TimeEntry за период события
  → если статус "Accepted" — confirmed
  → если "Tentative" — pending, не учитывается в сверке
  → если "Declined" — пропускается
```

Пользователь может через UI перепривязать событие к другой задаче или отвязать.

---

## Slack

### Что делает
- Slash command `/giper-log 2h GFM-42 fixed bug` — лог времени из Slack
- Упоминание `GFM-42` в публичных каналах → создаётся коммент в задаче
  (если автор сообщения связан с юзером giper-pm)
- Кнопки на сообщениях: «Создать задачу», «Залогать время»
- Notifications кому-нужно через Slack DM (вместо TG, по выбору юзера)

### Setup
Slack app с scopes: `chat:write`, `commands`, `links:read`,
`channels:history` (только для каналов, где приглашён бот),
`im:write`.

---

## Figma

### Что делает (опционально)

- Webhook `FILE_UPDATE` слушает изменения в design-файлах проекта
- Создаёт `TimeEntry` source=`DIGITAL_GIT` (тот же тип, потому что суть та же — слабый сигнал) для дизайнера
- Эвристика: edit в файле = +30 мин, view не считается

---

## Категоризация активности (Desktop Agent)

Файл `packages/integrations/activity-rules/rules.json`:

```json
{
  "rules": [
    { "appName": ["Code", "Cursor", "WebStorm", "PyCharm", "iTerm", "Terminal"],
      "category": "CODING" },
    { "appName": ["Figma", "Sketch", "Adobe XD", "Photoshop"],
      "category": "DESIGN" },
    { "appName": ["zoom.us", "Google Meet", "Teams", "Discord"],
      "category": "MEETING" },
    { "appName": ["Slack", "Telegram", "Mail"],
      "category": "COMMUNICATION" },
    { "domain": ["github.com", "gitlab.com", "stackoverflow.com", 
                 "developer.mozilla.org", "docs.python.org"],
      "category": "RESEARCH" },
    { "domain": ["youtube.com", "twitter.com", "vk.com", "tiktok.com",
                 "reddit.com"],
      "category": "BROWSING" }
  ],
  "default": "UNKNOWN"
}
```

Правила применяются в порядке: первое совпавшее побеждает.

## Маппинг activity → задача

```
Сначала ищем явные сигналы в windowTitle:
  - регексп TASK-ID (`GFM-42`) → задача найдена
  - имя файла из git-репо проекта → задача = последняя in-progress в этом проекте у юзера

Если ничего не сматчилось:
  - категория есть, задача = null
  - такое entry попадает в "Прочее" в отчёте
```
