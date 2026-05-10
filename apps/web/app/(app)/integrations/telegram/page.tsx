import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth';
import { canManageAssignments, canSeeSettings } from '@/lib/permissions';
import { prisma } from '@giper/db';
import {
  TelegramIntegrationWizard,
  type WizardBot,
  type WizardChatLink,
  type WizardProject,
} from '@/components/domain/TelegramIntegrationWizard';

export const dynamic = 'force-dynamic';

export default async function TelegramIntegrationPage() {
  const me = await requireAuth();
  if (!canSeeSettings({ id: me.id, role: me.role })) notFound();

  const [botRow, projectRows, linkRows] = await Promise.all([
    prisma.userTelegramBot.findFirst({
      where: { userId: me.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        botUsername: true,
        botName: true,
        isActive: true,
        lastError: true,
        lastPolledAt: true,
      },
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { ownerId: me.id },
          { members: { some: { userId: me.id, role: 'LEAD' } } },
          ...(me.role === 'ADMIN' || me.role === 'PM' ? [{}] : []),
        ],
        status: { not: 'ARCHIVED' },
      },
      orderBy: [{ key: 'asc' }],
      select: { key: true, name: true, ownerId: true, members: { select: { userId: true, role: true } } },
    }),
    prisma.projectTelegramChat.findMany({
      where: { bot: { userId: me.id } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        telegramChatId: true,
        chatTitle: true,
        createdAt: true,
        project: { select: { key: true, name: true } },
        _count: { select: { ingestMessages: true } },
      },
    }),
  ]);

  // Filter projects user can manage assignments on (PM/ADMIN/owner/LEAD).
  const projects: WizardProject[] = projectRows
    .filter((p) =>
      canManageAssignments(
        { id: me.id, role: me.role },
        { ownerId: p.ownerId, members: p.members },
      ),
    )
    .map((p) => ({ key: p.key, name: p.name }));

  const bot: WizardBot | null = botRow
    ? {
        id: botRow.id,
        botUsername: botRow.botUsername,
        botName: botRow.botName,
        isActive: botRow.isActive,
        lastError: botRow.lastError,
        lastPolledAt: botRow.lastPolledAt ? botRow.lastPolledAt.toISOString() : null,
      }
    : null;

  const links: WizardChatLink[] = linkRows.map((l) => ({
    id: l.id,
    projectKey: l.project.key,
    projectName: l.project.name,
    chatTitle: l.chatTitle,
    telegramChatId: l.telegramChatId,
    bufferedMessages: l._count.ingestMessages,
    createdAt: l.createdAt.toISOString(),
  }));

  return (
    <>
      <div className="mx-auto flex max-w-2xl items-center justify-end gap-3 px-6 pt-4 text-xs">
        <Link href="/settings" className="text-muted-foreground underline">
          Общие настройки
        </Link>
      </div>
      <TelegramIntegrationWizard bot={bot} projects={projects} links={links} />
    </>
  );
}
