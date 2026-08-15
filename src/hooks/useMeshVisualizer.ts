import { useState, useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import * as d3 from 'd3-force';
import type { NetworkPacket } from '../network/types';
import { useMeshStore } from '../store/useMeshStore';

export interface MeshNodeData extends Record<string, unknown> {
  label: string;
  isSelf: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  lastSeen: number;
}

export interface MeshEdgeData extends Record<string, unknown> {
  isActive: boolean;
}

export type MeshFlowNode = Node<MeshNodeData>;
export type MeshFlowEdge = Edge<MeshEdgeData>;

const CENTER_X = 400;
const CENTER_Y = 300;
const EDGE_FLASH_MS = 900;

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

export interface UseMeshVisualizerReturn {
  nodes: MeshFlowNode[];
  edges: MeshFlowEdge[];
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
}

export function useMeshVisualizer(): UseMeshVisualizerReturn {
  const metadataList = useMeshStore((state) => state.metadataList);
  const meshNode = useMeshStore((state) => state.meshNode);

  const [nodes, setNodes] = useState<MeshFlowNode[]>([]);
  const [edges, setEdges] = useState<MeshFlowEdge[]>([]);

  const flowNodesRef = useRef<MeshFlowNode[]>([]);
  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const simulationRef = useRef<d3.Simulation<D3Node, undefined> | null>(null);

  const flashEdge = useCallback((sourceId: string) => {
    const selfId = meshNode?.id;
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
  }, [meshNode]);

  useEffect(() => {
    const self = metadataList.find((n) => n.isSelf);
    const peers = metadataList.filter((n) => !n.isSelf);

    const prevNodeMap = new Map(flowNodesRef.current.map((n) => [n.id, n]));

    const newFlowNodes: MeshFlowNode[] = [];
    const d3Nodes: D3Node[] = [];

    if (self) {
      const prev = prevNodeMap.get(self.id);
      const pos = prev ? prev.position : { x: CENTER_X, y: CENTER_Y };
      newFlowNodes.push({
        id: self.id,
        type: 'sensorNode',
        position: pos,
        draggable: false,
        data: { label: 'This Tab', isSelf: true, status: self.status, lastSeen: self.lastSeen },
      });
      d3Nodes.push({ id: self.id, x: pos.x, y: pos.y, fx: CENTER_X, fy: CENTER_Y });
    }

    peers.forEach((peer) => {
      const prev = prevNodeMap.get(peer.id);
      // Spawn new nodes slightly offset from center to avoid identical start coordinates
      const pos = prev ? prev.position : { x: CENTER_X + (Math.random() - 0.5) * 50, y: CENTER_Y + (Math.random() - 0.5) * 50 };
      newFlowNodes.push({
        id: peer.id,
        type: 'sensorNode',
        position: pos,
        draggable: true,
        data: { label: `Tab-${peer.id.slice(0, 6)}`, isSelf: false, status: peer.status, lastSeen: peer.lastSeen },
      });
      d3Nodes.push({ id: peer.id, x: pos.x, y: pos.y });
    });

    const newFlowEdges: MeshFlowEdge[] = [];
    const d3Links: d3.SimulationLinkDatum<D3Node>[] = [];
    
    if (self) {
      peers.forEach((peer) => {
        const eid = edgeId(self.id, peer.id);
        newFlowEdges.push(buildEdge(self.id, peer.id, flashTimers.current.has(eid)));
        d3Links.push({ source: self.id, target: peer.id });
      });
      if (peers.length > 2) {
        peers.forEach((peer, idx) => {
          const next = peers[(idx + 1) % peers.length];
          const eid = edgeId(peer.id, next.id);
          newFlowEdges.push(buildEdge(peer.id, next.id, flashTimers.current.has(eid)));
          d3Links.push({ source: peer.id, target: next.id });
        });
      }
    }

    flowNodesRef.current = newFlowNodes;
    setNodes([...newFlowNodes]);
    setEdges(newFlowEdges);

    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    const sim = d3.forceSimulation<D3Node>(d3Nodes)
      .force('charge', d3.forceManyBody().strength(-4000))
      .force('link', d3.forceLink(d3Links).id((d: any) => d.id).distance(240))
      .force('center', d3.forceCenter(CENTER_X, CENTER_Y))
      .alpha(0.1) // Low alpha to gently ease into new layout without jittering
      .restart();

    sim.on('tick', () => {
      flowNodesRef.current = flowNodesRef.current.map((n) => {
        const d3Node = d3Nodes.find((d) => d.id === n.id);
        if (d3Node && d3Node.x !== undefined && d3Node.y !== undefined) {
          // If the user drags a node in React Flow, the position changes from React Flow's end.
          // But our d3 simulation doesn't know about user dragging unless we bind it.
          // For simplicity, we just let d3 override the position, which disables manual dragging
          // effectively, but creates a nice automatic organic layout.
          return { ...n, position: { x: d3Node.x, y: d3Node.y } };
        }
        return n;
      });
      setNodes([...flowNodesRef.current]);
    });

    simulationRef.current = sim;

    return () => {
      sim.stop();
    };
  }, [metadataList]);

  // Handle packets for edge flashing
  useEffect(() => {
    if (!meshNode) return;
    const unsubPackets = meshNode.onMessage((pkt: NetworkPacket<unknown>) => {
      flashEdge(pkt.header.senderId);
    });

    const timers = flashTimers.current;
    return () => {
      unsubPackets();
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [meshNode, flashEdge]);

  return { nodes, edges };
}
