# CONVENTIONS.md

## Структура apps/web

```
apps/web/
├── app/
│   ├── (auth)/                  # public routes (login, accept-invite)
│   ├── (app)/                   # protected routes
│   │   ├── layout.tsx           # sidebar + header
│   │   ├── dashboard/page.tsx
│   │   ├── projects/
│   │   │   ├── page.tsx                    # список
│   │   │   └── [projectKey]/
│   │   │       ├── page.tsx                # обзор
│   │   │       ├── board/page.tsx          # канбан
│   │   │       ├── list/page.tsx           # список задач
│   │   │       └── tasks/[number]/page.tsx # детальная
│   │   ├── time/page.tsx
│   │   ├── reports/page.tsx
│   │   └── settings/...
│   ├── api/
│   │   ├── agent/
│   │   ├── webhooks/
│   │   └── auth/[...nextauth]/route.ts
│   └── layout.tsx
├── actions/                     # Server Actions, тонкие
│   ├── tasks.ts
│   ├── time.ts
│   ├── projects.ts
│   └── ...
├── components/
│   ├── ui/                      # shadcn (button, dialog, ...)
│   └── domain/                  # доменные (TaskCard, KanbanBoard, ...)
├── lib/
│   ├── auth.ts                  # NextAuth config + helpers
│   ├── permissions.ts           # canUserDoX(...)
│   ├── tasks/                   # use-cases
│   │   ├── createTask.ts
│   │   ├── changeStatus.ts
│   │   └── ...
│   ├── time/
│   ├── activity/
│   └── reports/
├── messages/
│   ├── ru.json                  # все UI-строки
│   └── en.json                  # на будущее
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

## Структура packages

```
packages/
├── db/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   └── src/
│       └── index.ts             # экспорт PrismaClient
├── shared/
│   ├── src/
│   │   ├── schemas/             # zod-схемы (общие для всех apps)
│   │   ├── types/               # доменные типы
│   │   ├── time.ts              # утилиты для времени
│   │   └── tasks.ts             # утилиты для задач
│   └── package.json
├── ui/
│   ├── src/
│   │   ├── components/          # переиспользуемые компоненты
│   │   ├── tokens.ts            # design tokens
│   │   └── tailwind.config.ts   # base config
│   └── package.json
└── integrations/
    ├── src/
    │   ├── registry.ts
    │   ├── github/
    │   ├── bitrix24/
    │   ├── slack/
    │   └── ...
    └── package.json
```

## Именование

### Файлы
- React компоненты — `PascalCase.tsx` (`TaskCard.tsx`)
- Use-cases — `camelCase.ts` (`createTask.ts`)
- Server Actions — `camelCase.ts`, файл = группа экшенов (`tasks.ts`)
- Утилиты — `camelCase.ts`
- Константы — `kebab-case.ts` (`task-statuses.ts`)
- Тесты — рядом с файлом, `*.test.ts` или в `tests/`

### Код
- Переменные, функции — `camelCase`
- Классы, типы, интерфейсы — `PascalCase`
- Константы — `SCREAMING_SNAKE_CASE` если глобальные, `camelCase` если локальные
- Boolean переменные — `is/has/can/should` префикс
- Функции, возвращающие boolean — `is/has/can/should`
- Async функции — глагол: `loadTasks()`, `createUser()`

### Domain language
Используем английские термины кода с осмысленным значением:

| Понятие              | В коде            | В UI (ru)         |
|----------------------|-------------------|-------------------|
| Project              | `Project`         | Проект            |
| Task                 | `Task`            | Задача            |
| Status               | `TaskStatus`      | Статус            |
| Time entry           | `TimeEntry`       | Запись времени    |
| Time tracking        | `time tracking`   | Учёт времени      |
| Live timer           | `LiveTimer`       | Таймер            |
| Activity             | `Activity`        | Активность        |
| Reconciliation       | `reconciliation`  | Сверка            |

## TypeScript

- `tsconfig.json` strict: true, no `any` в production code (тесты — можно)
- Imports — абсолютные через `@/...` или `@giper/...` для пакетов
- Барелы (`index.ts`) — только в `packages/`, не в `apps/`
- Никаких `default export` для бизнес-логики (только React-компоненты как исключение)

## Commits

Convention: `<type>(<scope>): <subject>`

Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `style`.

Scopes: `web`, `agent`, `bot`, `db`, `shared`, `integrations/<kind>`.

Примеры:
- `feat(web): add kanban board`
- `fix(agent): handle idle detection on Linux`
- `refactor(db): split Task and Activity into separate modules`
- `docs: update PRIVACY.md with screenshot retention details`

Один коммит = один логический шаг. Не мешать рефакторинг с фичами.

## Тестирование

### Что покрываем тестами
- **Use-cases в `lib/`** — unit тесты обязательно
- **Сложная логика категоризации/маппинга** — unit + edge cases
- **Server Actions** — integration тесты с тестовой БД
- **Webhooks** — integration с моками
- **Critical UI flows** — e2e (login → создать задачу → залогать время)

### Что не покрываем
- Тривиальные геттеры
- Чистая презентация (UI без логики)
- shadcn-компоненты

### Тулинг
- Vitest для unit/integration
- Playwright для e2e
- Test DB через Docker, отдельная от dev: `giper_pm_test`
- Truncate таблиц между тестами вместо drop/recreate (быстрее)

## Linting и форматирование

- ESLint с `@typescript-eslint`, плюс `eslint-config-next`
- Prettier с `tailwindcss` плагином
- Husky pre-commit: `lint-staged` → eslint + prettier на staged
- Pre-push: `pnpm test` (только unit, не e2e)

## Логи и наблюдаемость

- `pino` для structured logs
- В production — JSON, в dev — `pino-pretty`
- Уровень `debug` только локально, в проде `info` и выше
- Sentry для ошибок в production
- Простые метрики: `/api/internal/metrics` (Prometheus format)

Никаких `console.log` в production-коде. Если нужен лог — `logger.info(...)`.

## Безопасность

- Все user-input через Zod
- Никогда не доверяем `userId` из запроса — берём из session/token
- `assertCanUserDo(...)` перед каждой мутацией
- Rate limiting на /api/agent/* (Upstash или своё на Redis)
- HTTPS only в проде, HSTS, secure cookies
- CSP заголовки настроены в Next config
- SQL — только через Prisma, никаких raw queries без необходимости
- Пароли — никогда не логируются, токены — маскируются в логах

## Performance

- Server Components по умолчанию
- Client Components только если нужен `useState`/`useEffect` или браузерные API
- Списки длиннее 100 элементов — виртуализация (`@tanstack/react-virtual`)
- N+1 — Prisma `include`/`select`, не итеративные запросы
- Картинки — `next/image`, скриншоты — отдельный CDN с короткой подписью
