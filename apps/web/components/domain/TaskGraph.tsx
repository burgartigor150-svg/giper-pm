'use client';

import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';

type GraphNodeData = {
  number: number;
  title: string;
  internalStatus: string;
  projectKey: string;
  kind: 'root' | 'parent' | 'subtask' | 'blocks' | 'blockedBy';
};

type Props = {
  nodes: Array<{
    id: string;
    number: number;
    title: string;
    status: string;
    internalStatus: string;
    projectKey: string;
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

/**
 * Vertical hierarchical task graph. Layout: dagre top-to-bottom so
 * parents sit above subtasks, blockers above blocked. Custom node card
 * shows the project key, task number, title, and status pill.
 */
export function TaskGraph({ nodes, edges }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64 });

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
          projectKey: n.projectKey,
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
          e.kind === 'blocks' ? '#ef4444' : e.kind === 'parent' ? '#94a3b8' : '#3b82f6',
        strokeWidth: 1.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color:
          e.kind === 'blocks' ? '#ef4444' : e.kind === 'parent' ? '#94a3b8' : '#3b82f6',
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
    <Link
      href={`/projects/${data.projectKey}/tasks/${data.number}`}
      className={`flex flex-col gap-1 rounded-md border bg-white px-3 py-2 text-xs shadow-sm hover:bg-muted ${
        isRoot ? 'border-blue-500 ring-2 ring-blue-200' : 'border-border'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      data-id={id}
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
  );
}
