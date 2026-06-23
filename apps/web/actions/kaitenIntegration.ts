'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type MemberRole } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { canEditProject } from '@/lib/permissions';
import { getEffectiveCaps } from '@/lib/capabilities';
import { KaitenClient, normalizeKaitenDomain } from '@giper/integrations/kaiten';
import {
  saveKaitenConnection,
  disconnectKaiten,
  runKaitenSyncNow,
} from '@/lib/integrations/kaiten';

type ConnectResult = { ok: true } | { ok: false; error: string };
type SyncResult = { ok: boolean; summary: string };

type GateOk = { ok: true; projectId: string };
type GateFail = { ok: false; error: string };

/** Load the project and check the caller may configure its integrations. */
async function gateProject(projectKey: string): Promise<GateOk | GateFail> {
  const me = await requireAuth();
  const project = await prisma.project.findUnique({
    where: { key: projectKey },
    select: { id: true, ownerId: true, members: { select: { userId: true, role: true } } },
  });
  if (!project) return { ok: false, error: 'Проект не найден' };
  const caps = await getEffectiveCaps(me);
  const members = project.members as { userId: string; role: MemberRole }[];
  if (!canEditProject(me, { ownerId: project.ownerId, members }, caps)) {
    return { ok: false, error: 'Недостаточно прав' };
  }
  return { ok: true, projectId: project.id };
}

export async function connectKaitenAction(input: {
  projectKey: string;
  domain: string;
  token: string;
  boardId: number;
  spaceId?: number;
}): Promise<ConnectResult> {
  const gated = await gateProject(input.projectKey);
  if (!gated.ok) return { ok: false, error: gated.error };

  const domain = normalizeKaitenDomain(input.domain);
  if (!domain) return { ok: false, error: 'Неверный домен Kaiten (ожидается <компания>.kaiten.ru)' };
  const token = input.token.trim();
  if (!token) return { ok: false, error: 'Укажите API-ключ Kaiten' };
  const boardId = Number(input.boardId);
  if (!Number.isInteger(boardId) || boardId <= 0) return { ok: false, error: 'Укажите корректный ID доски' };
  if (input.spaceId !== undefined && (!Number.isInteger(input.spaceId) || input.spaceId <= 0)) {
    return { ok: false, error: 'ID пространства должен быть положительным числом' };
  }

  // Validate the token + board access before persisting.
  try {
    const client = new KaitenClient({ domain, apiKey: token });
    await client.validate(boardId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Не удалось подключиться к Kaiten: ${msg.slice(0, 160)}` };
  }

  const err = await saveKaitenConnection({
    projectId: gated.projectId,
    domain,
    token,
    boardId,
    spaceId: input.spaceId,
  });
  if (err) return { ok: false, error: err };

  revalidatePath(`/projects/${input.projectKey}/settings`);
  return { ok: true };
}

export async function disconnectKaitenAction(input: { projectKey: string }): Promise<ConnectResult> {
  const gated = await gateProject(input.projectKey);
  if (!gated.ok) return { ok: false, error: gated.error };
  await disconnectKaiten(gated.projectId);
  revalidatePath(`/projects/${input.projectKey}/settings`);
  return { ok: true };
}

export async function syncKaitenAction(input: { projectKey: string }): Promise<SyncResult> {
  const gated = await gateProject(input.projectKey);
  if (!gated.ok) return { ok: false, summary: gated.error };
  const outcome = await runKaitenSyncNow(gated.projectId);
  revalidatePath(`/projects/${input.projectKey}/settings`);
  revalidatePath(`/projects/${input.projectKey}`);
  return { ok: outcome.ok, summary: outcome.summary };
}
