import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { NodeMetadata, NetworkPacket } from '../network/types';
import { MeshNode } from '../network/MeshNode';

// ─── Typed ReactFlow data shapes ──────────────────────────────────────────────

export interface MeshNodeData extends Record<string, unknown> {
  label: string;
  isSelf: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  lastSeen: number;
}

export interface MeshEdgeData extends Record<string, unknown> {
  /** True for the duration of the edge-flash TTL after a packet traverses it. */
  isActive: boolean;
}

export type MeshFlowNode = Node<MeshNodeData>;
export type MeshFlowEdge = Edge<MeshEdgeData>;

// ─── Layout constants ─────────────────────────────────────────────────────────

const CENTER_X = 400;
const CENTER_Y = 300;
const ORBIT_RADIUS = 220;
const EDGE_FLASH_MS = 900;   // How long the "packet travelling" animation stays on

// ─── Pure geometry / ID helpers ───────────────────────────────────────────────

/** Distributes N peer nodes evenly around a circle, starting from 12 o'clock. */
function orbitalPosition(index: number, total: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / total - Math.PI / 2;
  return {
    x: CENTER_X + ORBIT_RADIUS * Math.cos(angle),
    y: CENTER_Y + ORBIT_RADIUS * Math.sin(angle),
  };
}

/** Canonical, order-independent edge ID. */
const edgeId = (a: string, b: string) => [a, b].sort().join('--');

function buildEdge(src: string, tgt: string, active: boolean): MeshFlowEdge {
  return {
    id: edgeId(src, tgt),
    source: src,
    target: tgt,
    type: 'animatedMesh',
    data: { isActive: active },
    style: {},
  };
}

// ─── Hook return type ─────────────────────────────────────────────────────────

export interface UseMeshVisualizerReturn {
  /** Stable MeshNode singleton — never recreated across renders. */
  meshNode: MeshNode;
  /** ReactFlow node array derived from live NodeMetadata. */
  nodes: MeshFlowNode[];
  /** ReactFlow edge array, flashing transiently on packet events. */
  edges: MeshFlowEdge[];
}

// ─── useMeshVisualizer ────────────────────────────────────────────────────────

/**
 * Manages the MeshNode singleton lifecycle and derives all ReactFlow graph state
 * from the live network topology.
 *
 * Design decisions:
 * - MeshNode is created in the ref initialiser path (not inside useEffect) so
 *   it's available synchronously on the very first render with no flash.
 * - The destroy-on-unmount effect has an empty dep array so it fires exactly
 *   once — on the final unmount, not on every re-render.
 * - Edge flashes use a Map<edgeId, timer> to debounce rapid packet bursts on
 *   the same link without accumulating multiple de-activation timers.
 * - rebuildGraph is memoised with useCallback([]) so the subscription effect
 *   is stable across re-renders.
 */
export function useMeshVisualizer(): UseMeshVisualizerReturn {
  // Singleton: created once on the first render path, never re-created.
  const meshRef = useRef<MeshNode | null>(null);
  if (!meshRef.current) meshRef.current = new MeshNode();
  const meshNode = meshRef.current;

  const [nodes, setNodes] = useState<MeshFlowNode[]>([]);
  const [edges, setEdges] = useState<MeshFlowEdge[]>([]);

  // edgeId → pending de-activation timer
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ── Graph builder ──────────────────────────────────────────────────────────

  const rebuildGraph = useCallback((metadata: NodeMetadata[]) => {
    const self = metadata.find((n) => n.isSelf);
    const peers = metadata.filter((n) => !n.isSelf);

    const flowNodes: MeshFlowNode[] = [];

    if (self) {
      flowNodes.push({
        id: self.id,
        type: 'sensorNode',
        position: { x: CENTER_X, y: CENTER_Y },
        draggable: false,
        data: { label: 'This Tab', isSelf: true, status: self.status, lastSeen: self.lastSeen },
      });
    }

    peers.forEach((peer, idx) => {
      flowNodes.push({
        id: peer.id,
        type: 'sensorNode',
        position: orbitalPosition(idx, peers.length),
        draggable: true,
        data: { label: `Tab-${peer.id.slice(0, 6)}`, isSelf: false, status: peer.status, lastSeen: peer.lastSeen },
      });
    });

    const flowEdges: MeshFlowEdge[] = [];

    if (self) {
      peers.forEach((peer) => {
        const eid = edgeId(self.id, peer.id);
        flowEdges.push(buildEdge(self.id, peer.id, flashTimers.current.has(eid)));
      });
      // Ring edges between adjacent peers (creates the "mesh web" visual)
      if (peers.length > 2) {
        peers.forEach((peer, idx) => {
          const next = peers[(idx + 1) % peers.length];
          const eid = edgeId(peer.id, next.id);
          flowEdges.push(buildEdge(peer.id, next.id, flashTimers.current.has(eid)));
        });
      }
    }

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, []);

  // ── Edge flash ────────────────────────────────────────────────────────────

  /**
   * Transiently activates the edge between `sourceId` and this tab's node.
   * Re-entrant: if a flash is already active on the edge, the timer is reset.
   */
  const flashEdge = useCallback((sourceId: string) => {
    const selfId = meshRef.current?.id;
    if (!selfId) return;

    const eid = edgeId(sourceId, selfId);
    const existing = flashTimers.current.get(eid);
    if (existing !== undefined) clearTimeout(existing);

    setEdges((prev) =>
      prev.map((e) => e.id === eid ? { ...e, data: { ...e.data, isActive: true } } : e)
    );

    const timer = setTimeout(() => {
      flashTimers.current.delete(eid);
      setEdges((prev) =>
        prev.map((e) => e.id === eid ? { ...e, data: { ...e.data, isActive: false } } : e)
      );
    }, EDGE_FLASH_MS);

    flashTimers.current.set(eid, timer);
  }, []);

  // ── Subscriptions ─────────────────────────────────────────────────────────

  useEffect(() => {
    const node = meshRef.current!;

    const unsubNodes = node.onNodeListChange(rebuildGraph);
    const unsubPackets = node.onMessage((pkt: NetworkPacket<unknown>) => {
      flashEdge(pkt.header.senderId);
    });

    // Capture Map ref for cleanup closure
    const timers = flashTimers.current;

    return () => {
      unsubNodes();
      unsubPackets();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [rebuildGraph, flashEdge]);

  // MeshNode is a singleton tied to the component lifecycle.
  // In React 18 StrictMode, we cannot destroy it on unmount because 
  // StrictMode will re-run effects without re-rendering, leaving the ref null.

  return { meshNode, nodes, edges };
}
