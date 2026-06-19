import { prisma } from '@giper/db';

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

/** Deals (non-deleted) in a pipeline, with contact/owner names. Fault-tolerant. */
export async function listDealsForPipeline(pipelineId: string): Promise<BoardDeal[]> {
  try {
    const rows = await prisma.deal.findMany({
      where: { pipelineId, deletedAt: null },
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

/** Contacts (non-deleted) with deal counts. Fault-tolerant. */
export async function listContacts(): Promise<ContactRow[]> {
  try {
    const rows = await prisma.contact.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        company: true,
        email: true,
        phone: true,
        _count: { select: { deals: true } },
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

/** Aggregate pipeline stats for the summary strip. Fault-tolerant → zeros. */
export async function getPipelineSummary(pipelineId: string): Promise<PipelineSummary> {
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
      where: { pipelineId, deletedAt: null },
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
