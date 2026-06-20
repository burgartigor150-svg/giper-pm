import { prisma } from '@giper/db';
import { type SessionUser, type CrmAccess } from './permissions';
import { getEffectiveCaps } from './capabilities';

export type StageView = {
  id: string;
  name: string;
  order: number;
  kind: 'NORMAL' | 'WON' | 'LOST';
};

export type PipelineView = {
  id: string;
  name: string;
  stages: StageView[];
};

export type BoardDeal = {
  id: string;
  title: string;
  stageId: string;
  amount: number | null;
  currency: string;
  status: 'OPEN' | 'WON' | 'LOST';
  contactId: string | null;
  contactName: string | null;
  ownerName: string | null;
  lostReason: string | null;
  projectId: string | null;
  /** Project KEY (not id) — the drawer link is /projects/<key>. */
  projectKey: string | null;
  projectName: string | null;
};

export type PipelineSummary = {
  openValue: number;
  wonValue: number;
  openCount: number;
  wonCount: number;
  lostCount: number;
  winRate: number; // 0–100 over closed deals
};

const num = (d: { toNumber: () => number } | null): number | null => (d ? d.toNumber() : null);

/**
 * Read the current user's opt-in CRM flag from the DB at request time.
 * Fault-tolerant → false (a DB blip must never silently elevate access).
 * Resolve scope via resolveCrmAccess(user, getMyCrmAccess(user.id)).
 */
export async function getMyCrmAccess(userId: string): Promise<boolean> {
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { crmAccess: true } });
    return u?.crmAccess ?? false;
  } catch (e) {
    console.warn('getMyCrmAccess: unavailable', e);
    return false;
  }
}

/**
 * Owner scope for CRM queries. `null` → org-wide (ADMIN/PM, scope 'all');
 * a userId → a scoped rep, own records only. Pass the SAME value to the deal
 * list and the summary so the board and its stats can never desync.
 */
const ownerFilter = (ownerId: string | null) => (ownerId ? { ownerId } : {});

/**
 * Resolve a user's CRM access from BOTH sources, read per request from the DB:
 *   - the legacy opt-in crmAccess flag (→ own-scope rep), and
 *   - the custom-role overlay capabilities (crm.view / crm.scope.own|all).
 * ADMIN/PM stay org-wide. An explicit crm.scope.all cap (only grantable from an
 * ADMIN/PM-based role, per the floor clamp) yields org-wide; otherwise any CRM
 * grant resolves to own-scope, keeping the owner clamp on. This is the single
 * gate every CRM page + action goes through.
 */
export async function resolveMyCrmAccess(user: SessionUser): Promise<CrmAccess> {
  if (user.role === 'ADMIN' || user.role === 'PM') return { canSee: true, scope: 'all' };
  const [flag, caps] = await Promise.all([getMyCrmAccess(user.id), getEffectiveCaps(user)]);
  if (caps.has('crm.scope.all')) return { canSee: true, scope: 'all' };
  const canSee =
    caps.has('crm.view') || caps.has('crm.scope.own') || (flag && user.role !== 'VIEWER');
  return canSee ? { canSee: true, scope: 'own' } : { canSee: false, scope: 'none' };
}

/** Active (non-archived) pipelines with their ordered stages. Fault-tolerant. */
export async function listPipelines(): Promise<PipelineView[]> {
  try {
    const rows = await prisma.pipeline.findMany({
      where: { archivedAt: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        stages: {
          orderBy: { order: 'asc' },
          select: { id: true, name: true, order: true, kind: true },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, order: s.order, kind: s.kind ?? 'NORMAL' })),
    }));
  } catch (e) {
    console.warn('listPipelines: unavailable', e);
    return [];
  }
}

/**
 * Deals (non-deleted) in a pipeline, with contact/owner names. Fault-tolerant.
 * `ownerId` (null = org-wide) scopes to a single rep's own deals.
 */
export async function listDealsForPipeline(pipelineId: string, ownerId: string | null = null): Promise<BoardDeal[]> {
  try {
    const rows = await prisma.deal.findMany({
      where: { pipelineId, deletedAt: null, ...ownerFilter(ownerId) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        stageId: true,
        amount: true,
        currency: true,
        status: true,
        contactId: true,
        lostReason: true,
        projectId: true,
        contact: { select: { name: true } },
        owner: { select: { name: true } },
        project: { select: { key: true, name: true } },
      },
    });
    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      stageId: d.stageId,
      amount: num(d.amount),
      currency: d.currency,
      status: d.status,
      contactId: d.contactId ?? null,
      contactName: d.contact?.name ?? null,
      ownerName: d.owner?.name ?? null,
      lostReason: d.lostReason ?? null,
      projectId: d.projectId ?? null,
      projectKey: d.project?.key ?? null,
      projectName: d.project?.name ?? null,
    }));
  } catch (e) {
    console.warn('listDealsForPipeline: unavailable', e);
    return [];
  }
}

export type ContactRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  dealCount: number;
};

/**
 * Contacts (non-deleted) with deal counts. Fault-tolerant. `ownerId` (null =
 * org-wide) scopes to a rep's own contacts AND makes the per-contact deal count
 * own-only, so a scoped rep never sees a foreign deal tally on a shared contact.
 */
export async function listContacts(ownerId: string | null = null): Promise<ContactRow[]> {
  try {
    const rows = await prisma.contact.findMany({
      where: { deletedAt: null, ...ownerFilter(ownerId) },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        phone: true,
        _count: { select: { deals: ownerId ? { where: { ownerId, deletedAt: null } } : true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      dealCount: c._count.deals,
    }));
  } catch (e) {
    console.warn('listContacts: unavailable', e);
    return [];
  }
}

export type LeadRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string | null;
  status: 'NEW' | 'CONVERTED' | 'DISQUALIFIED';
  ownerName: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  createdAt: Date;
};

/**
 * Leads (non-deleted), newest-first, with owner name. Fault-tolerant.
 * `ownerId` (null = org-wide) scopes to a single rep's own leads.
 */
export async function listLeads(ownerId: string | null = null): Promise<LeadRow[]> {
  try {
    const rows = await prisma.lead.findMany({
      where: { deletedAt: null, ...ownerFilter(ownerId) },
      // id is a deterministic tiebreaker for leads created in the same ms
      // (cuid increments monotonically within a process → newest id sorts last).
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        source: true,
        status: true,
        convertedContactId: true,
        convertedDealId: true,
        createdAt: true,
        owner: { select: { name: true } },
      },
    });
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      email: l.email,
      phone: l.phone,
      company: l.company,
      source: l.source,
      status: l.status,
      ownerName: l.owner?.name ?? null,
      convertedContactId: l.convertedContactId ?? null,
      convertedDealId: l.convertedDealId ?? null,
      createdAt: l.createdAt,
    }));
  } catch (e) {
    console.warn('listLeads: unavailable', e);
    return [];
  }
}

/**
 * Aggregate pipeline stats for the summary strip. Fault-tolerant → zeros.
 * `ownerId` MUST match the value passed to listDealsForPipeline, or the summary
 * counts deals the rep can't see (scope desync).
 */
export async function getPipelineSummary(pipelineId: string, ownerId: string | null = null): Promise<PipelineSummary> {
  const empty: PipelineSummary = {
    openValue: 0,
    wonValue: 0,
    openCount: 0,
    wonCount: 0,
    lostCount: 0,
    winRate: 0,
  };
  try {
    const deals = await prisma.deal.findMany({
      where: { pipelineId, deletedAt: null, ...ownerFilter(ownerId) },
      select: { amount: true, status: true },
    });
    let openValue = 0;
    let wonValue = 0;
    let openCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    for (const d of deals) {
      const a = num(d.amount) ?? 0;
      if (d.status === 'OPEN') {
        openValue += a;
        openCount++;
      } else if (d.status === 'WON') {
        wonValue += a;
        wonCount++;
      } else {
        lostCount++;
      }
    }
    const closed = wonCount + lostCount;
    return {
      openValue: Math.round(openValue),
      wonValue: Math.round(wonValue),
      openCount,
      wonCount,
      lostCount,
      winRate: closed > 0 ? Math.round((wonCount / closed) * 100) : 0,
    };
  } catch (e) {
    console.warn('getPipelineSummary: unavailable', e);
    return empty;
  }
}
