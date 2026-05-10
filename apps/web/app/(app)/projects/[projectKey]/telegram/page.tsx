import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@giper/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@giper/ui/components/Card';
import { requireAuth } from '@/lib/auth';
import { getProject } from '@/lib/projects';
import { canManageAssignments } from '@/lib/permissions';
import { DomainError } from '@/lib/errors';
import { prisma } from '@giper/db';
import { ProjectTelegramPanel } from '@/components/domain/ProjectTelegramPanel';

export default async function ProjectTelegramPage({
  params,
}: {
  params: Promise<{ projectKey: string }>;
}) {
  const { projectKey } = await params;
  const user = await requireAuth();

  let project;
  try {
    project = await getProject(projectKey, { id: user.id, role: user.role });
  } catch (e) {
    if (e instanceof DomainError && (e.code === 'NOT_FOUND' || e.code === 'INSUFFICIENT_PERMISSIONS')) {
      notFound();
    }
    throw e;
  }

  if (
    !canManageAssignments(
      { id: user.id, role: user.role },
      { ownerId: project.ownerId, members: project.members },
    )
  ) {
    notFound();
  }

  const [links, myBot] = await Promise.all([
    prisma.projectTelegramChat.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramChatId: true,
        chatTitle: true,
        createdAt: true,
        bot: { select: { botUsername: true } },
        _count: { select: { ingestMessages: true } },
      },
    }),
    prisma.userTelegramBot.findFirst({
      where: { userId: user.id, isActive: true },
      select: { id: true, botUsername: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/projects/${project.key}`}>
          <Button variant="outline" size="sm">
            ← Проект
          </Button>
        </Link>
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{project.key}</span>
        <h1 className="text-xl font-semibold">Telegram → задачи</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Как это работает</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Подключите своего бота на странице{' '}
              <Link href="/integrations/telegram" className="underline text-foreground">
                Интеграции → Telegram
              </Link>
              {myBot ? (
                <>
                  {' '}
                  (сейчас:{' '}
                  <code className="rounded bg-muted px-1 text-foreground">@{myBot.botUsername}</code>)
                </>
              ) : (
                <>
                  {' '}
                  — бот ещё не подключён.
                </>
              )}
              .
            </li>
            <li>
              В @BotFather у бота отключите режим приватности группы — иначе бот видит только команды,
              а не обычные сообщения.
            </li>
            <li>Добавьте бота в свой рабочий чат или канал (как обычного участника).</li>
            <li>
              Сгенерируйте одноразовый код ниже и в том чате отправьте боту:{' '}
              <code className="rounded bg-muted px-1 text-foreground">/linkproj TG-…</code>
            </li>
            <li>
              Текстовые сообщения из чата сохраняются в буфер. Кнопкой «Собрать в задачи» (или командой{' '}
              <code className="rounded bg-muted px-1 text-foreground">/harvest</code> в чате) giper-pm создаёт
              задачи в проекте <span className="font-mono text-foreground">{project.key}</span> по одной на сообщение.
            </li>
          </ol>
          <p className="text-xs">
            История чата до добавления бота Telegram API не отдаёт — только сообщения после привязки.
          </p>
        </CardContent>
      </Card>

      <ProjectTelegramPanel projectKey={project.key} initialLinks={links} hasBot={!!myBot} />
    </div>
  );
}
