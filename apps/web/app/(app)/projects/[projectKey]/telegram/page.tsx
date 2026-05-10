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

  const links = await prisma.projectTelegramChat.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      telegramChatId: true,
      chatTitle: true,
      createdAt: true,
      _count: { select: { ingestMessages: true } },
    },
  });

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
              В <strong className="text-foreground">@BotFather</strong> отключи режим приватности группы у бота giper-pm
              (или бот не увидит обычные сообщения — только команды).
            </li>
            <li>
              Добавь бота в свой рабочий чат или канал (с правом читать сообщения).
            </li>
            <li>
              Сгенерируй одноразовый код ниже и в том чате отправь:{' '}
              <code className="rounded bg-muted px-1 text-foreground">/linkproj TG-…</code>
            </li>
            <li>
              Дальше текстовые сообщения из чата сохраняются в буфер. Команда{' '}
              <code className="rounded bg-muted px-1 text-foreground">/harvest</code> в этом же чате создаёт задачи в
              проекте <span className="font-mono text-foreground">{project.key}</span> из последних сообщений (по
              одной задаче на сообщение).
            </li>
          </ol>
          <p className="text-xs">
            История чата до добавления бота Telegram API не отдаёт — только сообщения после привязки.
          </p>
        </CardContent>
      </Card>

      <ProjectTelegramPanel projectKey={project.key} initialLinks={links} />
    </div>
  );
}
