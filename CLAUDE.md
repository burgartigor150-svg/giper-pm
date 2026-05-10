# CLAUDE.md — giper-pm

Этот файл — твоя точка входа. Читай его первым в каждой сессии.

## Что это за проект

**giper-pm** — внутренняя система управления проектами и трекинга времени для giper.fm.
Цель: видеть кто что делает, что сделано, сколько времени потрачено и на что —
с тройной сверкой данных (ручной ввод / автотрекер / цифровые следы).

Кастомное решение, потому что готовые (Bitrix24, Jira, Hubstaff) не закрывают
комбинацию «трекинг задач + время + автоактивность + интеграции с GitHub/CRM»
без зоопарка интеграций.

## Документы — в каком порядке читать

1. **CLAUDE.md** (этот файл) — правила работы и ссылки
2. **ARCHITECTURE.md** — компоненты, стек, как они связаны
3. **SCHEMA.prisma** — модель данных (источник истины)
4. **ROADMAP.md** — фазы реализации, что делаем сейчас
5. **PRIVACY.md** — этика, согласия, что можно/нельзя трекать
6. **INTEGRATIONS.md** — спеки на GitHub/Telegram/Calendar/Slack
7. **API.md** — REST/Server Actions контракты
8. **CONVENTIONS.md** — код-стайл, именование, структура папок

## Правила работы со мной (Claude Code)

### Роль
Я (Игорь) — заказчик и продакт. Ты — разработчик. Не советуй абстрактно,
а пиши работающий код. Когда есть выбор архитектуры — предлагай 2–3 варианта
с trade-off, но дальше код пиши сам, не спрашивай по мелочам.

### Язык
- Общение со мной — **по-русски**
- Код, коммиты, комментарии в коде, имена переменных — **по-английски**
- UI-тексты — **по-русски** (пользователи — команда giper.fm)

### Стиль кода
- TypeScript strict, без `any` без причины
- Server Components по умолчанию, Client — только где нужно
- Server Actions для мутаций, REST API только для внешних интеграций
- Zod для валидации на границах (формы, API, webhooks)
- Никаких хардкод-строк UI — все через `messages/ru.json` (next-intl)

### Что не делать
- Не писать длинные README с маркетингом
- Не предлагать «давайте сначала обсудим» — обсуждение уже было
- Не спрашивать разрешения каждый раз перед `pnpm install` — ставь и едь
- Не использовать `localStorage` для бизнес-данных, только UI-настройки

### Что делать всегда
- Перед изменением модели данных — обновить `SCHEMA.prisma` и сгенерить миграцию
- Перед добавлением новой интеграции — обновить `INTEGRATIONS.md`
- При изменении публичного API — обновить `API.md`
- Коммитить осмысленными чанками (один логический шаг = один коммит)

## Стек

- **Монорепо**: pnpm workspaces + Turborepo
- **Web**: Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui
- **БД**: PostgreSQL 16 + Prisma
- **Auth**: NextAuth (Google OAuth + Email magic-link)
- **Очереди/cron**: BullMQ + Redis (или Vercel Cron в проде)
- **Desktop-агент**: Electron + active-win + node-system-idle-time
- **Browser ext**: Chrome MV3 + Firefox MV3 (один кодбейз)
- **Telegram-бот**: grammY (Node)
- **Real-time**: Pusher / Ably / собственный WS на uWebSockets

## Команды

```bash
pnpm dev              # все приложения параллельно
pnpm dev:web          # только web
pnpm dev:agent        # только desktop-агент
pnpm dev:bot          # только tg-бот

pnpm db:migrate       # применить миграции (dev)
pnpm db:push          # быстрый синк схемы без миграции (только dev!)
pnpm db:studio        # Prisma Studio
pnpm db:seed          # тестовые данные

pnpm lint             # eslint + prettier check
pnpm test             # vitest
pnpm test:e2e         # playwright

pnpm build            # production build всего
```

## Структура монорепо

```
giper-pm/
├── apps/
│   ├── web/                    # Next.js — главное приложение
│   ├── desktop-agent/          # Electron — трекер активности
│   ├── browser-extension/      # Chrome/Firefox MV3
│   └── tg-bot/                 # Telegram-бот
├── packages/
│   ├── db/                     # Prisma schema + клиент + миграции
│   ├── shared/                 # общие типы, zod-схемы, утилиты
│   ├── ui/                     # shadcn компоненты + дизайн-токены
│   └── integrations/           # GitHub, Slack, Calendar, Bitrix24
├── infra/
│   ├── docker-compose.yml      # postgres, redis для локалки
│   └── deploy/                 # Dockerfile, coolify/k8s
└── docs/                       # эти файлы
```

## Окружение

Локальная разработка — `.env.local` в каждом app. Шаблоны в `.env.example`.
В проде — secrets через Coolify/Vault, никаких `.env` в git.

Минимальный `.env.local` для web:

```
DATABASE_URL=postgresql://giper:giper@localhost:5432/giper_pm
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=
# AES-256-GCM master key for encrypting personal Telegram bot tokens
# (UserTelegramBot.encryptedToken). Same value MUST be set for the
# tg-bot service. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TG_TOKEN_ENC_KEY=
REDIS_URL=redis://localhost:6379
```

## Где сейчас находимся

См. **ROADMAP.md** — раздел «Current sprint».
Перед тем как начать любую новую большую задачу — сверься с роадмапом и
обнови раздел «Current sprint» по итогу.
