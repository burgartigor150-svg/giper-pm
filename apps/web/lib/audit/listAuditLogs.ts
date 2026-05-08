import { prisma, type Prisma } from '@giper/db';

export type AuditFilter = {
  entity?: string;
  action?: string;
  userId?: string;
  q?: string;
  page?: number;
};

export type AuditRow = {
  id: string;
  createdAt: Date;
  entity: string;
  entityId: string;
  action: string;
  diff: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  user: { id: string; name: string; email: string; image: string | null } | null;
};

const PAGE_SIZE = 50;

export async function listAuditLogs(filter: AuditFilter): Promise<{
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filter.entity) where.entity = filter.entity;
  if (filter.action) where.action = filter.action;
  if (filter.userId) where.userId = filter.userId;
  if (filter.q) {
    where.OR = [
      { entityId: { contains: filter.q } },
      { action: { contains: filter.q, mode: 'insensitive' } },
    ];
  }
  const page = Math.max(1, filter.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        entity: true,
        entityId: true,
        action: true,
        diff: true,
        ipAddress: true,
        userAgent: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    items: rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Distinct entities + actions for the filter dropdowns. */
export async function getAuditFacets() {
  const [entityRows, actionRows] = await Promise.all([
    prisma.auditLog.findMany({
      distinct: ['entity'],
      select: { entity: true },
      take: 50,
    }),
    prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      take: 50,
    }),
  ]);
  return {
    entities: entityRows.map((r) => r.entity).sort(),
    actions: actionRows.map((r) => r.action).sort(),
  };
}
