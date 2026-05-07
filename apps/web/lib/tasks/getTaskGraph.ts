import { prisma } from '@giper/db';

export type GraphNode = {
  id: string;
  number: number;
  title: string;
  status: string;
  internalStatus: string;
  projectKey: string;
  /** "root" = the task being viewed; rest are colour-coded by edge kind. */
  kind: 'root' | 'parent' | 'subtask' | 'blocks' | 'blockedBy';
};

export type GraphEdge = {
  source: string;
  target: string;
  kind: 'parent' | 'subtask' | 'blocks';
};

/**
 * Build the local relations graph centred on `taskId`. We pull the
 * task's parent (1 level up), subtasks (1 level down), outgoing BLOCKS
 * edges, and incoming BLOCKED_BY edges. Deeper traversal is intentional
 * skipped — the dagre layout becomes unreadable past ~20 nodes, and
 * users that need wider context can drill through individual nodes.
 */
export async function getTaskGraph(taskId: string): Promise<{
  nodes: GraphNode[];
  edges: GraphEdge[];
} | null> {
  const root = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      internalStatus: true,
      project: { select: { key: true } },
      parent: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          internalStatus: true,
          project: { select: { key: true } },
        },
      },
      subtasks: {
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          internalStatus: true,
          project: { select: { key: true } },
        },
      },
      blocks: {
        select: {
          toTask: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              internalStatus: true,
              project: { select: { key: true } },
            },
          },
        },
      },
      blockedBy: {
        select: {
          fromTask: {
            select: {
              id: true,
              number: true,
              title: true,
              status: true,
              internalStatus: true,
              project: { select: { key: true } },
            },
          },
        },
      },
    },
  });
  if (!root) return null;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNode = new Set<string>();

  function pushNode(
    t: {
      id: string;
      number: number;
      title: string;
      status: string;
      internalStatus: string;
      project: { key: string };
    },
    kind: GraphNode['kind'],
  ) {
    if (seenNode.has(t.id)) return;
    seenNode.add(t.id);
    nodes.push({
      id: t.id,
      number: t.number,
      title: t.title,
      status: t.status,
      internalStatus: t.internalStatus,
      projectKey: t.project.key,
      kind,
    });
  }

  pushNode(root, 'root');
  if (root.parent) {
    pushNode(root.parent, 'parent');
    edges.push({ source: root.parent.id, target: root.id, kind: 'parent' });
  }
  for (const s of root.subtasks) {
    pushNode(s, 'subtask');
    edges.push({ source: root.id, target: s.id, kind: 'subtask' });
  }
  for (const b of root.blocks) {
    pushNode(b.toTask, 'blocks');
    edges.push({ source: root.id, target: b.toTask.id, kind: 'blocks' });
  }
  for (const b of root.blockedBy) {
    pushNode(b.fromTask, 'blockedBy');
    edges.push({ source: b.fromTask.id, target: root.id, kind: 'blocks' });
  }

  return { nodes, edges };
}
