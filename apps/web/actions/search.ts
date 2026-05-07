'use server';

import { prisma } from '@giper/db';
import { requireAuth } from '@/lib/auth';

/**
 * Unified search for the ⌘K command palette. Returns the top hits across
 * tasks, projects, and people the current user can see, plus a parsed
 * `KEY-N` task lookup for quick-jump (e.g. typing "KSRIA-42" surfaces that
 * task as the first hit even if the title doesn't match).
 *
 * Permissions: ADMIN/PM see everything; everyone else sees only entities
 * tied to projects they're a member of (or own).
 */

export type SearchHit =
  | {
      kind: 'task';
      id: string;
      title: string;
      number: number;
      projectKey: string;
      status: string;
    }
  | {
      kind: 'project';
      id: string;
      key: string;
      name: string;
    }
  | {
      kind: 'user';
      id: string;
      name: string;
      email: string;
      image: string | null;
    };

export type SearchResult = {
  query: string;
  /** Direct task hit when the query parses as KEY-N (case-insensitive). */
  exact: SearchHit | null;
  tasks: Extract<SearchHit, { kind: 'task' }>[];
  projects: Extract<SearchHit, { kind: 'project' }>[];
  users: Extract<SearchHit, { kind: 'user' }>[];
};

export async function searchAll(query: string): Promise<SearchResult> {
  const me = await requireAuth();
  const q = query.trim();
  const empty: SearchResult = {
    query: q,
    exact: null,
    tasks: [],
    projects: [],
    users: [],
  };
  if (q.length < 1) return empty;

  // Permission scope: regular users only see projects they participate in.
  const projectScope =
    me.role === 'ADMIN' || me.role === 'PM'
      ? {}
      : {
          OR: [
            { ownerId: me.id },
            { members: { some: { userId: me.id } } },
          ],
        };

  // Try exact KEY-N match first — letting power users jump by id.
  let exact: SearchHit | null = null;
  const keyMatch = q.match(/^([A-Z][A-Z0-9]{1,4})-(\d+)$/i);
  if (keyMatch && keyMatch[1] && keyMatch[2]) {
    const projectKey = keyMatch[1].toUpperCase();
    const taskNumber = Number(keyMatch[2]);
    const project = await prisma.project.findFirst({
      where: { key: projectKey, ...projectScope },
      select: { id: true, key: true },
    });
    if (project) {
      const task = await prisma.task.findUnique({
        where: {
          projectId_number: { projectId: project.id, number: taskNumber },
        },
        select: { id: true, number: true, title: true, status: true },
      });
      if (task) {
        exact = {
          kind: 'task',
          id: task.id,
          number: task.number,
          title: task.title,
          projectKey: project.key,
          status: task.status,
        };
      }
    }
  }

  // Run the three fuzzy queries in parallel.
  const [tasks, projects, users] = await Promise.all([
    prisma.task.findMany({
      where: {
        title: { contains: q, mode: 'insensitive' },
        status: { not: 'CANCELED' },
        project: projectScope,
      },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        project: { select: { key: true } },
      },
    }),
    prisma.project.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { key: { contains: q.toUpperCase() } },
        ],
        ...projectScope,
      },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: { id: true, key: true, name: true },
    }),
    q.length >= 2
      ? prisma.user.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          orderBy: { name: 'asc' },
          take: 5,
          select: { id: true, name: true, email: true, image: true },
        })
      : Promise.resolve([]),
  ]);

  return {
    query: q,
    exact,
    tasks: tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      number: t.number,
      title: t.title,
      projectKey: t.project.key,
      status: t.status,
    })),
    projects: projects.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      key: p.key,
      name: p.name,
    })),
    users: users.map((u) => ({
      kind: 'user' as const,
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
    })),
  };
}
