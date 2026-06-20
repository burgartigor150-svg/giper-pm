'use server';

import { revalidatePath } from 'next/cache';
import { prisma, type UserRole } from '@giper/db';
import { requireAuth } from '@/lib/auth';
import { DomainError } from '@/lib/errors';
import {
  canDeleteCrmPipeline,
  canEditCrm,
  type CrmAccess,
} from '@/lib/permissions';
import { resolveMyCrmAccess } from '@/lib/crm';
import { listProjectsForUser } from '@/lib/projects';

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string } };

const DENY = { ok: false, error: { code: 'INSUFFICIENT_PERMISSIONS', message: 'Только продажи (ADMIN/PM)' } } as const;

/**
 * Resolve the caller's CRM access from the DB flag (never the session). Use
 * `access.canSee` as the visibility gate and `ownWhere(access, me.id)` to scope
 * every id-targeted mutation to the rep's own rows (scope 'own'); ADMIN/PM
 * (scope 'all') get an empty filter = unchanged org-wide behavior.
 */
async function crmAccessFor(me: { id: string; role: UserRole }): Promise<CrmAccess> {
  return resolveMyCrmAccess({ id: me.id, role: me.role });
}

/** Owner filter for a scoped rep's WHERE clause. scope 'all'/'none' → {} (the
 *  canSee gate already blocked 'none'). */
const ownWhere = (access: CrmAccess, meId: string) =>
  access.scope === 'own' ? { ownerId: meId } : {};

function parseAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Whether a deal may link to `projectId`. For privileged callers (scope 'all')
 * this is existence-only (any ACTIVE project) — CRM is org-level. For a scoped
 * rep (scope 'own') it must be a project they can actually SEE (per-stake), else
 * linking + reading the deal back would disclose a foreign project's key/name.
 * null/empty (unlink) is always allowed.
 */
async function isLinkableProject(
  projectId: string | null | undefined,
  viewer: { access: CrmAccess; id: string; role: UserRole },
): Promise<boolean> {
  if (!projectId) return true;
  if (viewer.access.scope === 'own') {
    const visible = await listProjectsForUser({ id: viewer.id, role: viewer.role }, { scope: 'mine' });
    return visible.some((p) => p.id === projectId);
  }
  const p = await prisma.project.findFirst({
    where: { id: projectId, status: { not: 'ARCHIVED' } },
    select: { id: true },
  });
  return !!p;
}

/**
 * Whether a deal may link to `contactId`. Privileged callers are unrestricted
 * (the FK enforces existence). A scoped rep (scope 'own') may only attach a
 * contact they OWN — otherwise linking + reading back would disclose a foreign
 * contact's name. null/empty (no contact) is always allowed.
 */
async function isLinkableContact(
  contactId: string | null | undefined,
  access: CrmAccess,
  meId: string,
): Promise<boolean> {
  if (!contactId || access.scope !== 'own') return true;
  const c = await prisma.contact.findFirst({
    where: { id: contactId, deletedAt: null, ownerId: meId },
    select: { id: true },
  });
  return !!c;
}

/** Seed a default "Продажи" pipeline with standard stages (idempotent-ish). */
export async function createDefaultPipelineAction(): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  if (!canEditCrm({ id: me.id, role: me.role })) return DENY;
  const existing = await prisma.pipeline.findFirst({ where: { archivedAt: null }, select: { id: true } });
  if (existing) return { ok: true, data: { id: existing.id } };

  const p = await prisma.pipeline.create({
    data: {
      name: 'Продажи',
      order: 0,
      createdById: me.id,
      stages: {
        create: [
          { name: 'Новые', order: 0 },
          { name: 'Квалификация', order: 1 },
          { name: 'Предложение', order: 2 },
          { name: 'Выиграно', order: 3, kind: 'WON' },
          { name: 'Проиграно', order: 4, kind: 'LOST' },
        ],
      },
    },
    select: { id: true },
  });
  revalidatePath('/crm');
  return { ok: true, data: { id: p.id } };
}

/** Create a deal. Defaults to the pipeline's first stage when none given. */
export async function createDealAction(input: {
  pipelineId: string;
  title: string;
  amount?: string | number | null;
  contactId?: string | null;
  stageId?: string | null;
  projectId?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.title.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название сделки ≥ 2 символов' } };
  }
  if (!(await isLinkableProject(input.projectId, { access, id: me.id, role: me.role }))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Проект не найден' } };
  }
  if (!(await isLinkableContact(input.contactId, access, me.id))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Контакт не найден' } };
  }
  const stages = await prisma.pipelineStage.findMany({
    where: { pipelineId: input.pipelineId },
    orderBy: { order: 'asc' },
    select: { id: true, kind: true },
  });
  if (stages.length === 0) {
    return { ok: false, error: { code: 'VALIDATION', message: 'В воронке нет стадий' } };
  }
  const stage = input.stageId
    ? stages.find((s) => s.id === input.stageId)
    : stages[0];
  if (!stage) return { ok: false, error: { code: 'VALIDATION', message: 'Стадия не из этой воронки' } };

  const terminal = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
  const deal = await prisma.deal.create({
    data: {
      pipelineId: input.pipelineId,
      stageId: stage.id,
      title: input.title.trim().slice(0, 200),
      amount: parseAmount(input.amount),
      contactId: input.contactId || null,
      projectId: input.projectId || null,
      ownerId: me.id,
      createdById: me.id,
      status: terminal,
      closedAt: terminal === 'OPEN' ? null : new Date(),
    },
    select: { id: true },
  });
  revalidatePath('/crm');
  return { ok: true, data: { id: deal.id } };
}

/** Edit a deal's title / amount / contact. CRM editors (ADMIN/PM) only. */
export async function updateDealAction(
  dealId: string,
  input: {
    title: string;
    amount?: string | number | null;
    contactId?: string | null;
    projectId?: string | null;
  },
): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.title.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Название сделки ≥ 2 символов' } };
  }
  if (!(await isLinkableProject(input.projectId, { access, id: me.id, role: me.role }))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Проект не найден' } };
  }
  if (!(await isLinkableContact(input.contactId, access, me.id))) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Контакт не найден' } };
  }
  const upd = await prisma.deal.updateMany({
    where: { id: dealId, deletedAt: null, ...ownWhere(access, me.id) },
    data: {
      title: input.title.trim().slice(0, 200),
      amount: parseAmount(input.amount),
      contactId: input.contactId || null,
      projectId: input.projectId || null,
    },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } };
  revalidatePath('/crm');
  return { ok: true };
}

/** Move a deal to another stage in the same pipeline; flips WON/LOST on terminal stages. */
export async function moveDealStageAction(dealId: string, stageId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, ...ownWhere(access, me.id) },
    select: { pipelineId: true, status: true },
  });
  if (!deal) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } };
  const stage = await prisma.pipelineStage.findUnique({
    where: { id: stageId },
    select: { pipelineId: true, kind: true },
  });
  if (!stage || stage.pipelineId !== deal.pipelineId) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Стадия не из этой воронки' } };
  }
  const nextStatus = stage.kind === 'WON' ? 'WON' : stage.kind === 'LOST' ? 'LOST' : 'OPEN';
  const upd = await prisma.deal.updateMany({
    where: { id: dealId, ...ownWhere(access, me.id) },
    data: {
      stageId,
      status: nextStatus,
      closedAt: nextStatus === 'OPEN' ? null : new Date(),
    },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } };
  revalidatePath('/crm');
  return { ok: true };
}

/** Explicitly set a deal's WON/LOST/OPEN status (e.g. from the card buttons). */
export async function setDealStatusAction(
  dealId: string,
  status: 'OPEN' | 'WON' | 'LOST',
  opts: { lostReason?: string } = {},
): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  const upd = await prisma.deal.updateMany({
    where: { id: dealId, ...ownWhere(access, me.id) },
    data: {
      status,
      closedAt: status === 'OPEN' ? null : new Date(),
      lostReason: status === 'LOST' ? (opts.lostReason?.slice(0, 2000) ?? null) : null,
    },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Сделка не найдена' } };
  revalidatePath('/crm');
  return { ok: true };
}

/** Create a contact. */
export async function createContactAction(input: {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  const c = await prisma.contact.create({
    data: {
      name: input.name.trim().slice(0, 200),
      company: input.company?.trim().slice(0, 200) || null,
      email: input.email?.trim().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 60) || null,
      ownerId: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/crm/contacts');
  return { ok: true, data: { id: c.id } };
}

/** Edit an existing contact. CRM editors (ADMIN/PM) only. */
export async function updateContactAction(
  contactId: string,
  input: { name: string; company?: string; email?: string; phone?: string },
): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  const upd = await prisma.contact.updateMany({
    where: { id: contactId, deletedAt: null, ...ownWhere(access, me.id) },
    data: {
      name: input.name.trim().slice(0, 200),
      company: input.company?.trim().slice(0, 200) || null,
      email: input.email?.trim().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 60) || null,
    },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Контакт не найден' } };
  revalidatePath('/crm/contacts');
  return { ok: true };
}

/** Soft-delete a contact (sets deletedAt; deals are kept). CRM editors only. */
export async function deleteContactAction(contactId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  const upd = await prisma.contact.updateMany({
    where: { id: contactId, deletedAt: null, ...ownWhere(access, me.id) },
    data: { deletedAt: new Date() },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Контакт не найден' } };
  revalidatePath('/crm/contacts');
  return { ok: true };
}

/** Archive (soft-delete) a pipeline. ADMIN only. */
export async function archivePipelineAction(pipelineId: string): Promise<ActionResult> {
  const me = await requireAuth();
  if (!canDeleteCrmPipeline({ id: me.id, role: me.role })) return DENY;
  await prisma.pipeline.update({ where: { id: pipelineId }, data: { archivedAt: new Date() } }).catch(() => {});
  revalidatePath('/crm');
  return { ok: true };
}

// ─────────────────────────────── Leads ───────────────────────────────

/** A lead is only useful if there's a way to reach it: require name + (email OR phone). */
function leadHasContact(email?: string | null, phone?: string | null): boolean {
  return !!(email?.trim() || phone?.trim());
}

/** Create a top-of-funnel lead (status NEW). CRM editors (ADMIN/PM) only. */
export async function createLeadAction(input: {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  notes?: string;
}): Promise<ActionResult<{ id: string }>> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  if (!leadHasContact(input.email, input.phone)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Укажите email или телефон' } };
  }
  const lead = await prisma.lead.create({
    data: {
      name: input.name.trim().slice(0, 200),
      email: input.email?.trim().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 60) || null,
      company: input.company?.trim().slice(0, 200) || null,
      source: input.source?.trim().slice(0, 120) || null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      status: 'NEW',
      ownerId: me.id,
      createdById: me.id,
    },
    select: { id: true },
  });
  revalidatePath('/crm/leads');
  return { ok: true, data: { id: lead.id } };
}

/**
 * Edit a lead's fields, and optionally flip NEW↔DISQUALIFIED.
 * CONVERTED leads are immutable history (use the convert audit trail instead).
 * Status is never set to CONVERTED here — that's convertLeadAction's job.
 */
export async function updateLeadAction(
  leadId: string,
  input: {
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    source?: string;
    notes?: string;
    status?: 'NEW' | 'DISQUALIFIED';
  },
): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  if (input.name.trim().length < 2) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Имя ≥ 2 символов' } };
  }
  if (!leadHasContact(input.email, input.phone)) {
    return { ok: false, error: { code: 'VALIDATION', message: 'Укажите email или телефон' } };
  }
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, ...ownWhere(access, me.id) },
    select: { status: true, deletedAt: true },
  });
  if (!lead || lead.deletedAt) {
    return { ok: false, error: { code: 'NOT_FOUND', message: 'Лид не найден' } };
  }
  if (lead.status === 'CONVERTED') {
    return { ok: false, error: { code: 'CONFLICT', message: 'Лид уже сконвертирован' } };
  }
  await prisma.lead.updateMany({
    where: { id: leadId, ...ownWhere(access, me.id) },
    data: {
      name: input.name.trim().slice(0, 200),
      email: input.email?.trim().slice(0, 200) || null,
      phone: input.phone?.trim().slice(0, 60) || null,
      company: input.company?.trim().slice(0, 200) || null,
      source: input.source?.trim().slice(0, 120) || null,
      notes: input.notes?.trim().slice(0, 2000) || null,
      ...(input.status ? { status: input.status } : {}),
    },
  });
  revalidatePath('/crm/leads');
  return { ok: true };
}

/** Soft-delete a lead (sets deletedAt). CRM editors only. */
export async function deleteLeadAction(leadId: string): Promise<ActionResult> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;
  const upd = await prisma.lead.updateMany({
    where: { id: leadId, deletedAt: null, ...ownWhere(access, me.id) },
    data: { deletedAt: new Date() },
  });
  if (upd.count === 0) return { ok: false, error: { code: 'NOT_FOUND', message: 'Лид не найден' } };
  revalidatePath('/crm/leads');
  return { ok: true };
}

/**
 * Convert a NEW lead into a Contact (and optionally a Deal in the default
 * pipeline's first stage). One-way and idempotent: a conditional
 * `updateMany(where status NEW)` is the atomic lock, so two racing converts
 * produce exactly one Contact/Deal — the loser's whole transaction rolls back.
 */
export async function convertLeadAction(
  leadId: string,
  opts: { createDeal?: boolean; dealTitle?: string; amount?: string | number | null } = {},
): Promise<ActionResult<{ contactId: string; dealId: string | null }>> {
  const me = await requireAuth();
  const access = await crmAccessFor(me);
  if (!access.canSee) return DENY;

  // Resolve the target stage OUTSIDE the tx, only when a deal is requested.
  // Contact-only convert must work for brand-new orgs that have no pipeline yet.
  let pipelineId: string | null = null;
  let stageId: string | null = null;
  if (opts.createDeal) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { archivedAt: null },
      orderBy: { order: 'asc' },
      select: { id: true, stages: { orderBy: { order: 'asc' }, take: 1, select: { id: true } } },
    });
    if (!pipeline || pipeline.stages.length === 0) {
      return { ok: false, error: { code: 'NO_PIPELINE', message: 'Сначала создайте воронку продаж' } };
    }
    pipelineId = pipeline.id;
    stageId = pipeline.stages[0]!.id;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { id: leadId, ...ownWhere(access, me.id) },
        select: { id: true, status: true, name: true, email: true, phone: true, company: true, deletedAt: true },
      });
      if (!lead || lead.deletedAt) throw new DomainError('NOT_FOUND', 404, 'Лид не найден');
      if (lead.status !== 'NEW') throw new DomainError('CONFLICT', 409, 'Лид уже сконвертирован');
      if (lead.name.trim().length < 2) throw new DomainError('VALIDATION', 400, 'Имя лида ≥ 2 символов');

      const contact = await tx.contact.create({
        data: {
          name: lead.name.trim().slice(0, 200),
          company: lead.company?.trim().slice(0, 200) || null,
          email: lead.email?.trim().slice(0, 200) || null,
          phone: lead.phone?.trim().slice(0, 60) || null,
          ownerId: me.id,
        },
        select: { id: true },
      });

      let dealId: string | null = null;
      if (pipelineId && stageId) {
        const deal = await tx.deal.create({
          data: {
            pipelineId,
            stageId,
            title: (opts.dealTitle?.trim() || lead.name.trim() || 'Сделка').slice(0, 200),
            amount: parseAmount(opts.amount),
            contactId: contact.id,
            ownerId: me.id,
            createdById: me.id,
            status: 'OPEN',
            closedAt: null,
          },
          select: { id: true },
        });
        dealId = deal.id;
      }

      // Atomic idempotency lock: only the convert that flips NEW→CONVERTED wins.
      const upd = await tx.lead.updateMany({
        where: { id: leadId, status: 'NEW', ...ownWhere(access, me.id) },
        data: {
          status: 'CONVERTED',
          convertedContactId: contact.id,
          convertedDealId: dealId,
          convertedAt: new Date(),
        },
      });
      if (upd.count !== 1) throw new DomainError('CONFLICT', 409, 'Лид уже сконвертирован');

      return { contactId: contact.id, dealId };
    });

    revalidatePath('/crm');
    revalidatePath('/crm/contacts');
    revalidatePath('/crm/leads');
    return { ok: true, data: result };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: { code: e.code, message: e.message } };
    throw e;
  }
}
