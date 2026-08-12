import { useMemo, memo, type CSSProperties } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { MeshEdgeData, MeshFlowNode, MeshFlowEdge } from '../../hooks/useMeshVisualizer';
import { SensorNode } from './SensorNode';

// ─── AnimatedMeshEdge ─────────────────────────────────────────────────────────

/**
 * Custom ReactFlow edge.
 *
 * Idle state:   1.2px zinc-700 bezier.
 * Active state: 2px cyan-400 with drop-shadow + orange-400 packet-dot
 *               travelling along the path via SVG `animateMotion`.
 *
 * The hidden <path> element is required as an mpath reference target for
 * `animateMotion` — BaseEdge renders its own separate SVG path, so we need
 * a duplicate with a stable DOM ID.
 *
 * Wrapped in React.memo so an idle edge never re-renders when unrelated
 * state changes in the parent.
 */
const AnimatedMeshEdgeInner = ({
  id,
  sourceX, sourceY, sourcePosition,
  targetX, targetY, targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<MeshEdgeData>>) => {
  const isActive = data?.isActive ?? false;

  const [edgePath, lx, ly] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  });

  const edgeStyle: CSSProperties = {
    stroke:      isActive ? '#22d3ee' : '#3f3f46',
    strokeWidth: isActive ? 2 : 1.2,
    filter:      isActive ? 'drop-shadow(0 0 5px rgba(34,211,238,0.7))' : 'none',
    transition:  'stroke 0.2s ease, stroke-width 0.2s ease, filter 0.2s ease',
  };

  // Stable path ID — scoped to this edge instance
  const pathId = `ame-${id}`;

  return (
    <>
      {/* mpath reference — invisible duplicate, needed by animateMotion */}
      <path id={pathId} d={edgePath} fill="none" stroke="none" />

      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        labelX={lx}
        labelY={ly}
        style={edgeStyle}
      />

      {/* Packet pulse — rendered only during active flash */}
      {isActive && (
        <g aria-hidden="true">
          <circle
            r={4.5}
            fill="#fb923c"
            style={{ filter: 'drop-shadow(0 0 4px #fb923c)' }}
          >
            <animateMotion dur="0.72s" repeatCount="1" fill="freeze">
              <mpath xlinkHref={`#${pathId}`} />
            </animateMotion>
          </circle>
        </g>
      )}
    </>
  );
};

export const AnimatedMeshEdge = memo(AnimatedMeshEdgeInner);

// ─── Static type maps ─────────────────────────────────────────────────────────

// Defined OUTSIDE the component so the object reference is stable across
// renders — ReactFlow will not re-register node/edge types unnecessarily.
const NODE_TYPES = { sensorNode: SensorNode } as const;
const EDGE_TYPES = { animatedMesh: AnimatedMeshEdge } as const;

// ─── MeshGraph ────────────────────────────────────────────────────────────────

export interface MeshGraphProps {
  externalNodes: MeshFlowNode[];
  externalEdges: MeshFlowEdge[];
}

/**
 * Full-screen ReactFlow canvas — pure renderer.
 *
 * Receives pre-computed nodes and edges from App.tsx (which owns the
 * useMeshVisualizer hook) so this component never creates a BroadcastChannel.
 *
 * Controls are placed at bottom-right but offset up to avoid colliding with
 * the TelemetryPanel (absolute bottom-6 right-6, ~280px wide × ~320px tall).
 */
export const MeshGraph = memo(({ externalNodes, externalEdges }: MeshGraphProps) => {
  const peerCount = useMemo(
    () => externalNodes.filter((n) => !n.data.isSelf).length,
    [externalNodes]
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>

      {/* Waiting-for-peers hint — centered, pointer-events off */}
      {peerCount === 0 && externalNodes.length > 0 && (
        <div
          className="anim-fade-in"
          style={{
            position:      'absolute',
            top:           '50%',
            left:          '50%',
            transform:     'translate(-50%, -50%)',
            zIndex:        5,
            pointerEvents: 'none',
            textAlign:     'center',
            paddingBottom: 80,   /* lift above the SOS terminal */
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 10 }}>📡</div>
          <p className="mono" style={{
            fontSize: 10, color: '#3f3f46',
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            Awaiting peers — open another tab
          </p>
        </div>
      )}

      <ReactFlow
        nodes={externalNodes}
        edges={externalEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        minZoom={0.3}
        maxZoom={3}
        colorMode="dark"
        style={{ background: 'transparent' }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color="rgba(39,39,42,0.6)"
        />
        {/*
          Controls at bottom-right with a margin-bottom offset so they sit
          above the TelemetryPanel (~340px from bottom).
        */}
        <Controls
          position="bottom-right"
          showInteractive={false}
          style={{ marginBottom: 350, marginRight: 16 }}
        />
      </ReactFlow>
    </div>
  );
});

MeshGraph.displayName = 'MeshGraph';
