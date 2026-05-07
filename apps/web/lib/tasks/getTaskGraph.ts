import { prisma } from '@giper/db';

export type GraphPerson = { id: string; name: string; image: string | null };

export type GraphNode = {
  id: string;
  number: number;
  title: string;
  status: string;
  internalStatus: string;
  priority: string;
  estimateHours: number | null;
  projectKey: string;
  assignee: GraphPerson | null;
  coAssignees: GraphPerson[];
  /**
   * "root" = the task being viewed.
   * "ancestor" = parent or further-up parents (chain to the top).
   * "descendant" = subtask anywhere down the tree (any depth).
   * "blocks" = task this one is blocking.
   * "blockedBy" = task that's blocking this one.
   */
  kind: 'root' | 'ancestor' | 'descendant' | 'blocks' | 'blockedBy';
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: 'parent' | 'subtask' | 'blocks';
};

const PERSON_SELECT = {
  select: { id: true, name: true, image: true },
} as const;

const TASK_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  internalStatus: true,
  priority: true,
  estimateHours: true,
  parentId: true,
  project: { select: { key: true } },
  assignee: PERSON_SELECT,
  assignments: {
    select: { user: PERSON_SELECT },
  },
} as const;

type TaskRow = {
  id: string;
  number: number;
  title: string;
  status: string;
  internalStatus: string;
  priority: string;
  estimateHours: { toString(): string } | null;
  parentId: string | null;
  project: { key: string };
  assignee: GraphPerson | null;
  assignments: { user: GraphPerson }[];
};

function toGraphNode(t: TaskRow, kind: GraphNode['kind']): GraphNode {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    status: t.status,
    internalStatus: t.internalStatus,
    priority: t.priority,
    estimateHours: t.estimateHours ? Number(t.estimateHours.toString()) : null,
    projectKey: t.project.key,
    assignee: t.assignee,
    coAssignees: t.assignments.map((a) => a.user),
    kind,
  };
}

/**
 * Build the full relations graph centred on `taskId`:
 *   - whole ancestor chain upwards (parent → grandparent → ...)
 *   - whole descendant tree downwards (subtasks of subtasks of ...)
 *   - 1-hop BLOCKS in both directions (deeper would explode visual
 *     budget; user can drill via clicking a node)
 *
 * Cycle-safe: ancestor walk has a depth cap, descendant BFS dedupes
 * via a visited set. Reads are batched with findMany so we don't N+1
 * even on a 50-subtask tree.
 */
export async function getTaskGraph(taskId: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
} | null> {
  const root = await prisma.task.findUnique({
    where: { id: taskId },
    select: TASK_SELECT,
  });
  if (!root) return null;

  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  nodes.set(root.id, toGraphNode(root, 'root'));

  // Ancestor chain (up). Cap at 8 to be safe against cycles in
  // mirrored data.
  let cursor: TaskRow | null = root;
  for (let i = 0; i < 8 && cursor?.parentId; i++) {
    const parent = await prisma.task.findUnique({
      where: { id: cursor.parentId },
      select: TASK_SELECT,
    });
    if (!parent) break;
    if (!nodes.has(parent.id)) {
      nodes.set(parent.id, toGraphNode(parent, 'ancestor'));
    }
    edges.push({ source: parent.id, target: cursor.id, kind: 'parent' });
    cursor = parent;
  }

  // Descendant tree (down). BFS one level at a time so we keep edges
  // connected to their actual parent, not the root.
  let frontier = [root.id];
  const visited = new Set<string>([root.id]);
  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const children = await prisma.task.findMany({
      where: { parentId: { in: frontier } },
      orderBy: { number: 'asc' },
      select: TASK_SELECT,
    });
    if (children.length === 0) break;
    const next: string[] = [];
    for (const c of children) {
      if (visited.has(c.id)) continue;
      visited.add(c.id);
      if (!nodes.has(c.id)) nodes.set(c.id, toGraphNode(c, 'descendant'));
      // c.parentId is guaranteed non-null here because we filtered on it.
      edges.push({ source: c.parentId!, target: c.id, kind: 'subtask' });
      next.push(c.id);
    }
    frontier = next;
  }

  // BLOCKS edges (1 hop both directions).
  const blocks = await prisma.taskDependency.findMany({
    where: { fromTaskId: root.id },
    select: { toTask: { select: TASK_SELECT } },
  });
  for (const b of blocks) {
    if (!nodes.has(b.toTask.id)) {
      nodes.set(b.toTask.id, toGraphNode(b.toTask, 'blocks'));
    }
    edges.push({ source: root.id, target: b.toTask.id, kind: 'blocks' });
  }
  const blockedBy = await prisma.taskDependency.findMany({
    where: { toTaskId: root.id },
    select: { fromTask: { select: TASK_SELECT } },
  });
  for (const b of blockedBy) {
    if (!nodes.has(b.fromTask.id)) {
      nodes.set(b.fromTask.id, toGraphNode(b.fromTask, 'blockedBy'));
    }
    edges.push({ source: b.fromTask.id, target: root.id, kind: 'blocks' });
  }

  return { nodes: Array.from(nodes.values()), edges };
}
