import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { MeshNodeData } from '../../hooks/useMeshVisualizer';

// ─── Type ─────────────────────────────────────────────────────────────────────

export type SensorNodeType = Node<MeshNodeData, 'sensorNode'>;

// ─── LED config table (avoids per-render ternary chains) ─────────────────────

interface LedConfig { color: string; animClass: string; }

function getLedConfig(isSelf: boolean, isOnline: boolean): LedConfig {
  if (!isOnline)  return { color: '#f87171', animClass: '' };            // offline — static red
  if (isSelf)     return { color: '#22d3ee', animClass: 'anim-self-led'  }; // self — cyan pulse
  return           { color: '#4ade80', animClass: 'anim-peer-led'        }; // peer — green pulse
}

function getBorderColor(isSelf: boolean, isOnline: boolean, selected: boolean): string {
  if (selected)   return '#22d3ee';
  if (!isOnline)  return '#3f3f46';   // zinc-700
  if (isSelf)     return '#22d3ee';   // cyan
  return '#3f3f46';                   // zinc-700 (peers keep a subtle border)
}

function getBoxShadow(isSelf: boolean, isOnline: boolean, selected: boolean): string {
  if (selected)          return '0 0 0 1px rgba(34,211,238,0.5), 0 0 20px rgba(34,211,238,0.25)';
  if (isSelf && isOnline) return undefined as unknown as string; // handled by .anim-self-ring
  return 'none';
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * SensorNode — hardware-sensor-style custom ReactFlow node.
 *
 * Visual anatomy (fixed proportions):
 * ┌─────────────────────────────────────────┐
 * │  ● LED   LABEL            [STATUS PILL] │  ← row 1 — status + identity
 * │  id:XXXXXXXX-XXXX  ·  seen 12:34:56     │  ← row 2 — monospace metadata
 * └─────────────────────────────────────────┘
 *
 * Performance notes:
 * - Wrapped in React.memo — only re-renders when data or selected changes.
 * - All keyframes are defined globally in index.css (no per-instance injection).
 * - Handles are pointer-events:none and opacity:0 — edge routing only.
 */
const SensorNodeInner = ({ data, selected }: NodeProps<SensorNodeType>) => {
  const { label, isSelf, status, lastSeen } = data;
  const isOnline  = status === 'ACTIVE';
  const led       = getLedConfig(isSelf, isOnline);
  const border    = getBorderColor(isSelf, isOnline, !!selected);
  const boxShadow = getBoxShadow(isSelf, isOnline, !!selected);

  const seenAt = lastSeen
    ? new Date(lastSeen).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <>
      {/* Hidden handles — only for ReactFlow edge anchor calculation */}
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Top}   style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

      {/* ── Node card ── */}
      <div
        className={isSelf && isOnline ? 'anim-self-ring' : ''}
        style={{
          background:   '#09090b',
          border:       `1px solid ${border}`,
          borderRadius: 8,
          boxShadow:    boxShadow,
          padding:      isSelf ? '8px 14px' : '6px 12px',
          minWidth:     isSelf ? 172 : 148,
          opacity:      isOnline ? 1 : 0.45,
          transition:   'opacity 0.4s ease, border-color 0.25s ease',
          userSelect:   'none',
          cursor:       'default',
        }}
      >
        {/* ── Row 1: LED + label + status pill ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>

          {/* 6-pixel LED indicator */}
          <div
            className={led.animClass}
            style={{
              width:        6,
              height:       6,
              borderRadius: '50%',
              flexShrink:   0,
              background:   led.color,
              boxShadow:    `0 0 6px 2px ${led.color}99`,
            }}
          />

          {/* Node label */}
          <span
            className="mono"
            style={{
              flex:          1,
              fontSize:      isSelf ? 11 : 10,
              fontWeight:    700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color:         isSelf ? '#22d3ee' : '#d4d4d8',
              whiteSpace:    'nowrap',
              overflow:      'hidden',
              textOverflow:  'ellipsis',
            }}
          >
            {label}
          </span>

          {/* Status pill */}
          <span
            className="mono"
            style={{
              fontSize:      8,
              fontWeight:    700,
              letterSpacing: '0.09em',
              color:         isOnline ? (isSelf ? '#22d3ee' : '#4ade80') : '#52525b',
              border:        `1px solid ${isOnline ? (isSelf ? 'rgba(34,211,238,0.4)' : 'rgba(74,222,128,0.4)') : '#3f3f46'}`,
              borderRadius:  4,
              padding:       '1px 5px',
              whiteSpace:    'nowrap',
              flexShrink:    0,
            }}
          >
            {isSelf ? 'SELF' : isOnline ? 'LIVE' : 'IDLE'}
          </span>
        </div>

        {/* ── Row 2: Metadata strip ── */}
        <div
          className="mono"
          style={{
            display:       'flex',
            gap:           8,
            marginTop:     5,
            fontSize:      8,
            color:         '#52525b',
            letterSpacing: '0.04em',
            overflow:      'hidden',
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
                title={isSelf ? 'This browser tab' : label}>
            {isSelf ? 'origin' : 'peer'}
          </span>
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {seenAt}
          </span>
        </div>
      </div>
    </>
  );
};

export const SensorNode = memo(SensorNodeInner);
