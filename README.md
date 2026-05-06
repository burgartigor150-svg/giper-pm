# giper-pm

Внутренняя система управления проектами и трекинга времени для giper.fm.

Документация: см. [CLAUDE.md](./CLAUDE.md), [ARCHITECTURE.md](./ARCHITECTURE.md),
[ROADMAP.md](./ROADMAP.md), [SCHEMA.prisma](./SCHEMA.prisma),
[CONVENTIONS.md](./CONVENTIONS.md), [API.md](./API.md),
[INTEGRATIONS.md](./INTEGRATIONS.md), [PRIVACY.md](./PRIVACY.md).

## Требования

- Node.js >= 20 (см. `.nvmrc`)
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.12.3 --activate`)
- Docker (для Postgres + Redis локально — будет добавлено позже)

## Запуск dev

```bash
pnpm install
pnpm dev          # все приложения параллельно
pnpm dev:web      # только apps/web на http://localhost:3000
```

## Структура

```
giper-pm/
├── apps/
│   └── web/              # Next.js 15 — главное приложение
├── packages/
│   ├── db/               # Prisma schema + клиент
│   ├── shared/           # zod-схемы и общие типы
│   └── ui/               # design tokens + переиспользуемые компоненты
└── docs (*.md в корне)
```

## Команды

```bash
pnpm dev              # turbo dev (все apps)
pnpm build            # production build
pnpm lint             # eslint + prettier check
pnpm test             # vitest
pnpm test:e2e         # playwright

pnpm db:migrate       # prisma migrate dev
pnpm db:push          # быстрый sync (только dev!)
pnpm db:studio        # Prisma Studio
pnpm db:seed          # тестовые данные
```

Текущая фаза разработки и ближайшие шаги — в [ROADMAP.md → Current sprint](./ROADMAP.md#current-sprint).
