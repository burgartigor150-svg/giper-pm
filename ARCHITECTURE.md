# ARCHITECTURE.md

## Высокоуровневая схема

```
┌──────────────────────────────────────────────────────────────┐
│                        WEB (Next.js)                         │
│   UI · Канбан · Тайм-трекер · Отчёты · Админка · Auth       │
│                  Server Actions + REST API                   │
└────────────────┬─────────────────────────────┬───────────────┘
                 │                             │
       ┌─────────┴────────┐          ┌─────────┴─────────┐
       │   PostgreSQL     │          │      Redis        │
       │   (источник      │          │  (кэш, очереди    │
       │    истины)       │          │   BullMQ, ws)     │
       └─────────┬────────┘          └─────────┬─────────┘
                 │                             │
   ┌─────────────┼─────────────────────────────┼─────────────┐
   │             │                             │             │
┌──┴──────────┐  │              ┌──────────────┴──┐  ┌───────┴────────┐
│  Desktop    │  │              │   Cron / Jobs   │  │   TG Bot       │
│  Agent      │──┘              │ (BullMQ workers)│  │   (grammY)     │
│ (Electron)  │ ─── HTTPS ──┐   │ - агрегация     │  │ - /start/stop  │
│ active-win  │             │   │ - антифрод      │  │ - подтверждать │
│ idle-detect │             │   │ - отчёты PM     │  │   часы         │
│ screenshots │             │   │ - sync CRM      │  └────────────────┘
└─────────────┘             │   └─────────────────┘
                            │
┌──────────────┐            │   ┌─────────────────┐
│  Browser     │ ─── HTTPS ─┼─→ │  Webhooks IN    │
│  Extension   │            │   │  /api/wh/github │
│  (MV3)       │            │   │  /api/wh/jira   │
│  active tab  │            │   │  /api/wh/cal    │
└──────────────┘            │   └─────────────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │   Внешние системы                     │
        │   GitHub · Bitrix24 · Slack ·         │
        │   Google Calendar · Figma             │
        └───────────────────────────────────────┘
```

## Компоненты

### 1. Web (apps/web)

**Next.js 15, App Router.**

Слои:
- `app/` — маршруты, страницы, layouts
- `app/(auth)/` — публичные (login, accept-invite)
- `app/(app)/` — закрытые маршруты, общий layout с сайдбаром
- `app/api/` — webhooks IN, integration callbacks, public endpoints
- `lib/` — бизнес-логика (use-cases), зависят только от db и shared
- `components/` — UI-компоненты (`ui/` — shadcn, `domain/` — доменные)
- `actions/` — Server Actions, тонкие обёртки над `lib/`

Принцип: **Server Actions вызывают use-cases из `lib/`. UI не лезет в БД напрямую.**

Пример пути запроса (старт таймера):
```
TimerButton (client) 
  → action: startTimer (server)
    → lib/time/startTimer.ts (use-case)
      → db.timeEntry.create + revalidatePath
```

### 2. Desktop Agent (apps/desktop-agent)

**Electron + Node, нативные модули.**

Что делает:
- Раз в **30 секунд** снимает: активное окно (`active-win`), idle-time
- Если idle > 5 минут — текущий таймер автопаузится (с уведомлением)
- Опционально (по согласию) — скриншот раз в 10 минут, downscale до 800px,
  PNG ~50KB, опционально blur, локальное превью с кнопкой «удалить»
- Категоризация активности по правилам (см. INTEGRATIONS.md)
- Батчит данные и шлёт на `/api/agent/activity` каждые 5 минут

Авторизация: при первом запуске — pairing-код из веба, агент получает
device-token, дальше шлёт его в `Authorization: Bearer`.

В трее всегда: текущая задача, кнопки Start/Stop/Pause, «Я не на работе».

### 3. Browser Extension (apps/browser-extension)

**Chrome MV3 (manifest v3), один кодбейз для Chrome и Firefox.**

Что делает:
- Background service worker слушает `chrome.tabs.onActivated`, `onUpdated`
- Раз в 30 секунд логирует активную вкладку (только домен + title)
- Не читает контент страниц, не трогает формы
- Шлёт в тот же `/api/agent/activity` endpoint, source=`browser`

Для тех, кто не ставит десктоп-агент (например, работают через RDP).

### 4. Telegram Bot (apps/tg-bot)

**grammY framework.**

Команды:
- `/start TASK-42` — старт таймера на задачу TASK-42
- `/start` — выбор задачи из In Progress (inline keyboard)
- `/stop [comment]` — стоп текущего таймера, опциональный коммент
- `/today` — суммарно за сегодня
- `/week` — отчёт за неделю
- `/log 2h TASK-42 fixed bug` — ручной лог времени
- `/pause`, `/resume` — пауза текущего

Pushes:
- Ежедневно в 18:00 — «Подтверди вчерашние X часов» с inline-кнопками
- При обнаружении расхождения автотрекера и ручного лога >30% — уведомление PM
- Утренний дайджест PM-а с задачами, ушедшими в просрочку

### 5. Background Jobs (apps/web — BullMQ workers)

Работают в том же Node-процессе что и web (для простоты деплоя).
В проде можно вынести в отдельный сервис.

Очереди:
- `activity-aggregation` — агрегирует raw Activity в дневные сводки (каждый час)
- `time-reconciliation` — сверка manual/auto/digital, флагает аномалии (раз в день, ночью)
- `reports` — генерация отчётов PM-у (утром в 9:00 локального времени)
- `integrations-sync` — синк задач с Bitrix24/Jira (каждые 5 минут)
- `notifications` — отправка уведомлений в TG/email

### 6. Integrations (packages/integrations)

Каждая интеграция — отдельный модуль, унифицированный интерфейс:

```ts
interface Integration {
  name: string;
  setup(config: IntegrationConfig): Promise<void>;
  syncIn(): Promise<SyncResult>;   // подтянуть из внешней системы
  syncOut(event: DomainEvent): Promise<void>;  // отправить наружу
  webhookHandler?: (payload: unknown) => Promise<void>;
}
```

Список — см. **INTEGRATIONS.md**.

## Поток данных: как считается «сколько потрачено»

Это сердце системы. Три источника, потом сверка.

### Источник 1: Manual

Ручной ввод (live timer, форма, TG-бот, /api/time).
Поле `source: 'manual'`, всегда привязан к `Task`.

### Источник 2: Auto (от Desktop Agent / Browser Extension)

Сырые `Activity` records → ночная агрегация в `AutoTimeEntry`:
1. Группируем по 5-минутным бакетам
2. Бакет имеет преобладающую категорию и app
3. Применяем правила маппинга (см. INTEGRATIONS.md):
   - в окне VS Code открыт файл из проекта X → задача проекта X
   - открыт Figma-файл связанный с задачей Y → задача Y
   - GitHub PR с упоминанием TASK-42 → задача TASK-42
4. Если задача не определена — категория без задачи (Coding/Meeting/etc.)

### Источник 3: Digital traces

Webhooks от GitHub/Bitrix24/Calendar:
- Коммит с `TASK-42` в сообщении → +30 мин на TASK-42 (эвристика)
- Календарная встреча 1ч с участием Васи → 1ч на категорию Meeting Васе
- PR review → +20 мин на задачу PR-а ревьюеру

`source: 'digital'`, эти entries — слабый сигнал, используются только для сверки.

### Сверка

Раз в сутки (job `time-reconciliation`) для каждого юзера за вчера:

```
manual_total  = sum(manual entries)
auto_total    = sum(auto entries) - idle - personal
digital_total = sum(digital entries)

discrepancy = |manual_total - auto_total| / max(manual_total, auto_total)

if discrepancy > 0.30:
  flag = 'review_needed'
  notify(user.pm, 'Расхождение для {user.name}: ручной={manual}, авто={auto}')
```

Это **не наказание**. Это сигнал «что-то не сходится» — либо забыл залогировать,
либо тайм-трекер собрал шум, либо была работа без компа (бумажная, телефонные звонки).

## Безопасность и приватность

Все детали — в **PRIVACY.md**. Ключевое:
- Каждый тип трекинга — отдельное согласие в БД (`UserConsent`)
- Сотрудник может в любой момент посмотреть **всё**, что система знает о нём:
  `/me/data` — экран с raw Activity, скринами, entries
- Скриншоты — opt-in, retention 30 дней, потом cron удаляет
- Pause-режим («Я не на работе») — агент полностью замолкает, ничего не пишется

## Развёртывание

**Dev**: Docker Compose локально (Postgres + Redis), `pnpm dev`.

**Prod**: Coolify на собственном VPS (Hetzner CX22+, 4 ГБ RAM хватит).
- Web как Node app behind Caddy/Traefik
- Postgres managed (Supabase/Neon) или в Docker с бэкапами в S3
- Redis в Docker
- Workers — тот же контейнер с web (либо отдельный с теми же образом)

Desktop-агент — собирается через electron-builder (.exe / .dmg / .AppImage),
автообновление через electron-updater + статический S3 bucket.
