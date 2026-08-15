import { useState } from 'react';
import { Priority, type TriageSOSData } from '../../network/serialization/Serializer';

const PRIORITY_LABEL: Record<Priority, string> = {
  [Priority.LOW]: 'LOW',
  [Priority.HIGH]: 'HIGH',
  [Priority.CRITICAL]: 'CRIT',
};

const PRIORITY_COLOR: Record<Priority, string> = {
  [Priority.LOW]: 'var(--brutal-white)',
  [Priority.HIGH]: 'var(--accent-warn)',
  [Priority.CRITICAL]: 'var(--accent-crit)',
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function AIProgressBar({ progress, isLoaded, isMockMode, error, loadModel }: {
  progress: number;
  isLoaded: boolean;
  isMockMode?: boolean;
  error: string | null;
  loadModel: () => void;
}) {
  if (error) {
    return (
      <div className="flex-col gap-1">
        <span className="text-sys truncate anim-blink" style={{ fontSize: 10, color: 'var(--accent-crit)' }} title={error}>
          [WARN: AI_ERROR]
        </span>
        <span className="text-terminal" style={{ fontSize: 9, color: 'var(--accent-crit)' }}>{error}</span>
      </div>
    );
  }
  if (!isLoaded && progress === 0) {
    return (
      <button className="btn" onClick={loadModel}>
        [INIT AI ENGINE]
      </button>
    );
  }
  if (isLoaded) {
    const color = isMockMode ? 'var(--accent-warn)' : 'var(--accent-radar)';
    const text = isMockMode ? '[WARN: AI_MOCK]' : '[SYS: AI_ONLINE]';
    return (
      <span className="text-sys" style={{ fontSize: 10, color }}>
        {text}
      </span>
    );
  }
  return (
    <div className="flex-col gap-1 w-full">
      <div className="flex-row justify-between">
        <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-white)' }}>[SYS: DOWNLOADING_LLM]</span>
        <span className="text-sys" style={{ fontSize: 9, color: 'var(--accent-radar)' }}>{progress}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function TerminalRow({ msg }: { msg: TriageSOSData }) {
  const color = PRIORITY_COLOR[msg.priority];
  const label = PRIORITY_LABEL[msg.priority];

  return (
    <div className="flex-col" style={{ padding: '4px', borderBottom: '1px solid var(--brutal-dark-grey)' }}>
      <div className="flex-row gap-2">
        <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>
          [{formatTs(msg.timestamp)}]
        </span>
        <span className="text-sys" style={{ fontSize: 9, color }}>
          [{label}]
        </span>
        <span className="text-sys truncate" style={{ fontSize: 9, color: 'var(--accent-radar)', flex: 1 }}>
          {msg.id.slice(0, 8)}
        </span>
      </div>
      <p className="text-terminal" style={{ fontSize: 10, color: 'var(--brutal-white)', paddingLeft: 4, marginTop: 2, wordBreak: 'break-all' }}>
        {'>'} {msg.medicalNeed}
      </p>
      {msg.hazard && msg.hazard !== 'None' && (
        <p className="text-sys anim-blink-fast" style={{ fontSize: 9, color: 'var(--accent-warn)', paddingLeft: 4, marginTop: 2 }}>
          [HAZARD_DETECTED: {msg.hazard}]
        </p>
      )}
    </div>
  );
}

export interface TelemetryPanelProps {
  activeNodes: number;
  aiProgress: number;
  isAILoaded: boolean;
  isMockMode?: boolean;
  aiError: string | null;
  messages: TriageSOSData[];
  compressionMetric: string;
  peerjsId?: string | null;
  onConnectPeer?: (id: string) => void;
  loadModel: () => void;
  nodeRole: 'FIELD_RADIO' | 'BASE_STATION';
  onRoleToggle: (role: 'FIELD_RADIO' | 'BASE_STATION') => void;
  onSetSignaling: (ip: string) => void;
  encryptionKey: string;
  onSetEncryptionKey: (key: string) => void;
}

export function TelemetryPanel({
  activeNodes,
  aiProgress,
  isAILoaded,
  isMockMode,
  aiError,
  messages,
  compressionMetric,
  peerjsId,
  onConnectPeer,
  loadModel,
  nodeRole,
  onRoleToggle,
  onSetSignaling,
  encryptionKey,
  onSetEncryptionKey,
}: TelemetryPanelProps) {
  const peerCount = Math.max(0, activeNodes - 1);
  const [connectId, setConnectId] = useState('');
  const [signalingIp, setSignalingIp] = useState('');
  const [keyInput, setKeyInput] = useState(encryptionKey);

  return (
    <div className="flex-col" style={{ width: '100%', height: '100%', background: 'var(--bg-void)' }}>
      
      {/* ── Node Status Grid ── */}
      <div className="pane-header">
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-white)' }}>[SYS_STATUS]</span>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--brutal-grey)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <div className="brutal-box flex-col">
            <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>NODES_TOTAL</span>
            <span className="text-sys" style={{ fontSize: 14, color: 'var(--accent-radar)' }}>{activeNodes}</span>
          </div>
          <div className="brutal-box flex-col">
            <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>PEERS_ACTIVE</span>
            <span className="text-sys" style={{ fontSize: 14, color: peerCount > 0 ? 'var(--accent-radar)' : 'var(--accent-warn)' }}>{peerCount}</span>
          </div>
        </div>
        
        <div className="brutal-box flex-col gap-2" style={{ marginTop: 4 }}>
          {nodeRole === 'BASE_STATION' ? (
            <AIProgressBar progress={aiProgress} isLoaded={isAILoaded} isMockMode={isMockMode} error={aiError} loadModel={loadModel} />
          ) : (
            <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-light-grey)' }}>
              [AI_ENGINE_DISABLED: FIELD_RADIO_MODE]
            </span>
          )}
          {compressionMetric && (
            <span className="text-sys" style={{ fontSize: 9, color: 'var(--accent-radar)' }}>
              [PROTOBUF: {compressionMetric}]
            </span>
          )}
        </div>
      </div>

      {/* ── Topology Controls ── */}
      <div className="pane-header">
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-white)' }}>[TOPOLOGY_CTRL]</span>
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--brutal-grey)', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button
          className="btn"
          onClick={() => onRoleToggle(nodeRole === 'FIELD_RADIO' ? 'BASE_STATION' : 'FIELD_RADIO')}
        >
          [ROLE: {nodeRole}]
        </button>
        <div className="flex-row gap-2">
          <input
            type="text"
            placeholder="LOCAL_DROP_NODE_IP (e.g. 192.168.4.1)"
            value={signalingIp}
            onChange={(e) => setSignalingIp(e.target.value)}
            className="input-area"
            style={{ flex: 1, fontSize: 9 }}
          />
          <button
            onClick={() => onSetSignaling(signalingIp.trim())}
            className="btn"
            style={{ width: '60px', fontSize: 9 }}
            disabled={!signalingIp.trim()}
          >
            [RE-INIT]
          </button>
        </div>
        <div className="flex-row gap-2">
          <input
            type="text"
            placeholder="AES-GCM_PSK..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="input-area"
            style={{ flex: 1, fontSize: 9 }}
          />
          <button
            onClick={() => onSetEncryptionKey(keyInput.trim())}
            className="btn"
            style={{ width: '60px', fontSize: 9 }}
            disabled={!keyInput.trim()}
          >
            [SET_KEY]
          </button>
        </div>
      </div>

      {/* ── WebRTC Manual Connect ── */}
      <div className="pane-header">
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-white)' }}>[LINK_ESTABLISH]</span>
        {peerjsId ? (
          <button
            onClick={() => navigator.clipboard.writeText(peerjsId)}
            className="text-sys"
            style={{ fontSize: 8, color: 'var(--accent-radar)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            [COPY_LOCAL_ID]
          </button>
        ) : (
          <span className="text-sys anim-blink" style={{ fontSize: 8, color: 'var(--accent-warn)' }}>[AWAITING_ID]</span>
        )}
      </div>
      <div style={{ padding: 8, borderBottom: '1px solid var(--brutal-grey)' }} className="flex-row gap-2">
        <input
          type="text"
          placeholder="TARGET_ID..."
          value={connectId}
          onChange={(e) => setConnectId(e.target.value)}
          className="input-area"
          style={{ flex: 1 }}
        />
        <button
          onClick={() => {
            if (connectId.trim() && onConnectPeer) {
              onConnectPeer(connectId.trim());
              setConnectId('');
            }
          }}
          disabled={!connectId.trim()}
          className="btn"
          style={{ width: '80px' }}
        >
          [CONN]
        </button>
      </div>

      {/* ── Live Terminal Stream ── */}
      <div className="pane-header">
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-white)' }}>[LIVE_STREAM]</span>
        <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>RX:{messages.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--brutal-dark-grey)' }}>
        {messages.length === 0 ? (
          <div className="text-sys anim-blink" style={{ padding: 8, fontSize: 10, color: 'var(--brutal-light-grey)' }}>
            [WAITING_FOR_DATA...]
          </div>
        ) : (
          [...messages].reverse().map((msg) => (
            <TerminalRow key={msg.id} msg={msg} />
          ))
        )}
      </div>
    </div>
  );
}
