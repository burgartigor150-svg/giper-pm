'use client';

import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';
import { Avatar } from '@giper/ui/components/Avatar';

type Person = { id: string; name: string; image: string | null };

type GraphNodeData = {
  number: number;
  title: string;
  internalStatus: string;
  priority: string;
  estimateHours: number | null;
  projectKey: string;
  assignee: Person | null;
  coAssignees: Person[];
  kind: 'root' | 'ancestor' | 'descendant' | 'blocks' | 'blockedBy';
};

type Props = {
  nodes: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    internalStatus: string;
    priority: string;
    estimateHours: number | null;
    projectKey: string;
    assignee: Person | null;
    coAssignees: Person[];
    kind: GraphNodeData['kind'];
  }>;
  edges: Array<{
    source: string;
    target: string;
    kind: 'parent' | 'subtask' | 'blocks';
  }>;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 64;

const STATUS_COLOR: Record<string, string> = {
  BACKLOG: '#94a3b8',
  TODO: '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  REVIEW: '#a855f7',
  BLOCKED: '#ef4444',
  DONE: '#10b981',
  CANCELED: '#6b7280',
};

const PRIORITY_DOT: Record<string, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  URGENT: '#ef4444',
};

const PRIORITY_LABEL: Record<string, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  URGENT: 'Срочно',
};

/**
 * Vertical hierarchical task graph. Layout: dagre top-to-bottom so
 * parents sit above subtasks, blockers above blocked. Custom node card
 * shows project key, status pill, priority dot, assignee + co-assignees,
 * and estimate.
 */
export function TaskGraph({ nodes, edges }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 56, ranksep: 80 });

    for (const n of nodes) {
      g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }
    for (const e of edges) {
      g.setEdge(e.source, e.target);
    }
    dagre.layout(g);

    const rf: Node<GraphNodeData>[] = nodes.map((n) => {
      const pos = g.node(n.id);
      return {
        id: n.id,
        type: 'taskCard',
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          number: n.number,
          title: n.title,
          internalStatus: n.internalStatus,
          priority: n.priority,
          estimateHours: n.estimateHours,
          projectKey: n.projectKey,
          assignee: n.assignee,
          coAssignees: n.coAssignees,
          kind: n.kind,
        },
        draggable: false,
      };
    });

    const rfE: Edge[] = edges.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      animated: e.kind === 'blocks',
      label: e.kind === 'blocks' ? 'blocks' : undefined,
      labelStyle: { fontSize: 10 },
      style: {
        stroke:
          e.kind === 'blocks'
            ? '#ef4444'
            : e.kind === 'parent'
              ? '#94a3b8'
              : '#3b82f6',
        strokeWidth: 1.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          e.kind === 'blocks'
            ? '#ef4444'
            : e.kind === 'parent'
              ? '#94a3b8'
              : '#3b82f6',
      },
    }));

    return { rfNodes: rf, rfEdges: rfE };
  }, [nodes, edges]);

  return (
    <div className="h-[480px] rounded-md border border-border bg-background">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={{ taskCard: TaskCardNode }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function TaskCardNode({ data, id }: { data: GraphNodeData; id: string }) {
  const colour = STATUS_COLOR[data.internalStatus] ?? '#94a3b8';
  const isRoot = data.kind === 'root';
  return (
    <div
      className="group relative"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      data-id={id}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'transparent', border: 'none' }}
      />
      <Link
        href={`/projects/${data.projectKey}/tasks/${data.number}`}
        className={`flex h-full w-full flex-col gap-1 rounded-md border bg-white px-3 py-2 text-xs shadow-sm hover:bg-muted ${
          isRoot ? 'border-blue-500 ring-2 ring-blue-200' : 'border-border'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {data.projectKey}-{data.number}
          </span>
          <span
            className="rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white"
            style={{ backgroundColor: colour }}
          >
            {data.internalStatus}
          </span>
        </div>
        <span className="line-clamp-2 text-xs">{data.title}</span>
      </Link>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'transparent', border: 'none' }}
      />
      <TaskHoverCard data={data} />
    </div>
  );
}

/**
 * Detail tooltip that appears on hover over the small node card.
 * Positioned to the right of the node so it doesn't cover its own
 * trigger or the parent edge above. Uses group-hover so it doesn't
 * need a JS state.
 */
function TaskHoverCard({ data }: { data: GraphNodeData }) {
  const allWorkers = [
    ...(data.assignee ? [data.assignee] : []),
    ...data.coAssignees.filter((u) => u.id !== data.assignee?.id),
  ];
  const prioColour = PRIORITY_DOT[data.priority] ?? '#94a3b8';
  const statusColour = STATUS_COLOR[data.internalStatus] ?? '#94a3b8';

  return (
    <div className="pointer-events-none absolute left-full top-0 z-50 ml-2 hidden w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg group-hover:block">
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="font-mono">
          {data.projectKey}-{data.number}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] text-white"
          style={{ backgroundColor: statusColour }}
        >
          {data.internalStatus}
        </span>
      </div>
      <div className="mb-2 text-sm font-medium">{data.title}</div>
      <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1.5">
        <dt className="text-muted-foreground">Исполнитель</dt>
        <dd>
          {data.assignee ? (
            <span className="inline-flex items-center gap-1.5">
              <Avatar
                src={data.assignee.image}
                alt={data.assignee.name}
                className="h-4 w-4"
              />
              {data.assignee.name}
            </span>
          ) : (
            <span className="italic text-muted-foreground">не назначен</span>
          )}
        </dd>
        {data.coAssignees.length > 0 ? (
          <>
            <dt className="text-muted-foreground">Соисполнители</dt>
            <dd className="flex flex-col gap-1">
              {data.coAssignees.map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1.5">
                  <Avatar src={u.image} alt={u.name} className="h-4 w-4" />
                  {u.name}
                </span>
              ))}
            </dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Срочность</dt>
        <dd className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: prioColour }}
          />
          {PRIORITY_LABEL[data.priority] ?? data.priority}
        </dd>
        <dt className="text-muted-foreground">Оценка</dt>
        <dd>
          {data.estimateHours != null
            ? `${data.estimateHours} ч`
            : <span className="italic text-muted-foreground">нет</span>}
        </dd>
        {allWorkers.length === 0 ? null : (
          <>
            <dt className="text-muted-foreground">Работают</dt>
            <dd>{allWorkers.length}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
