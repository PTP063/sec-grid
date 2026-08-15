import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { MeshNodeData } from '../../hooks/useMeshVisualizer';

export type SensorNodeType = Node<MeshNodeData, 'sensorNode'>;

const SensorNodeInner = ({ data, selected }: NodeProps<SensorNodeType>) => {
  const { label, isSelf, status, lastSeen } = data;
  const isOnline  = status === 'ACTIVE';

  const borderColor = selected ? 'var(--brutal-white)' : (isSelf ? 'var(--accent-radar)' : 'var(--brutal-grey)');
  const shadowClass = selected ? 'brutal-shadow' : (isSelf ? 'brutal-shadow' : '');
  const textColor = isSelf ? 'var(--accent-radar)' : (isOnline ? 'var(--brutal-white)' : 'var(--brutal-light-grey)');
  
  const asciiStatus = isSelf ? '[SELF]' : (isOnline ? '[LIVE]' : '[DEAD]');
  const asciiLed = isSelf ? '[+]' : (isOnline ? '[*]' : '[-]');

  const seenAt = lastSeen
    ? new Date(lastSeen).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <>
      <Handle type="target" position={Position.Left}  style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="target" position={Position.Top}   style={{ opacity: 0, pointerEvents: 'none' }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, pointerEvents: 'none' }} />

      <div
        className={shadowClass}
        style={{
          background:   'var(--bg-void)',
          border:       `1px solid ${borderColor}`,
          padding:      '6px',
          minWidth:     150,
          opacity:      isOnline ? 1 : 0.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--brutal-dark-grey)', paddingBottom: 4 }}>
          <span className={isOnline && !isSelf ? "anim-blink" : ""} style={{ fontSize: 10, color: textColor, fontWeight: 700 }}>
            {asciiLed}
          </span>
          <span
            className="text-sys"
            style={{
              flex: 1,
              fontSize: 10,
              color: textColor,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
          <span className="text-sys" style={{ fontSize: 9, color: textColor }}>
            {asciiStatus}
          </span>
        </div>

        <div className="flex-row justify-between" style={{ marginTop: 4 }}>
          <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
            {isSelf ? 'ORIGIN' : 'PEER'}
          </span>
          <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
            {seenAt}
          </span>
        </div>
      </div>
    </>
  );
};

export const SensorNode = memo(SensorNodeInner);
