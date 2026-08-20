import { useState, useMemo, memo } from 'react';
import { Priority, type TriageSOSData, type TriageStatus } from '../../network/serialization/Serializer';
import { useMessageStore, type TriageFilter } from '../../store/useMessageStore';

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

const STATUS_COLOR: Record<TriageStatus, string> = {
  PENDING: 'var(--accent-warn)',
  ACKNOWLEDGED: 'var(--accent-radar)',
  RESOLVED: 'var(--brutal-light-grey)',
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

interface MessageCardProps {
  msg: TriageSOSData;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onUpdateStatus?: (id: string, status: TriageStatus) => void;
  onRetriage?: (msg: TriageSOSData) => void;
  isBaseStation: boolean;
  isAILoaded: boolean;
}

const MessageCard = memo(function MessageCard({
  msg,
  isSelected,
  onSelect,
  onUpdateStatus,
  onRetriage,
  isBaseStation,
  isAILoaded,
}: MessageCardProps) {
  const [copied, setCopied] = useState(false);
  const color = PRIORITY_COLOR[msg.priority];
  const label = PRIORITY_LABEL[msg.priority];
  const status = msg.status || 'PENDING';
  const statusColor = STATUS_COLOR[status];

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(msg.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      onClick={() => onSelect(msg.id)}
      className="flex-col message-card"
      style={{
        padding: '6px 8px',
        borderBottom: '1px solid var(--brutal-dark-grey)',
        background: isSelected ? 'rgba(0, 255, 102, 0.05)' : 'transparent',
        borderLeft: isSelected ? '3px solid var(--accent-radar)' : msg.priority === Priority.CRITICAL ? '3px solid var(--accent-crit)' : '3px solid transparent',
        cursor: 'pointer',
        transition: 'all 0.1s ease',
      }}
    >
      {/* Header Row */}
      <div className="flex-row justify-between" style={{ gap: 4 }}>
        <div className="flex-row gap-1">
          <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
            [{formatTs(msg.timestamp)}]
          </span>
          <span className="text-sys" style={{ fontSize: 8, color, fontWeight: 700 }}>
            [{label}]
          </span>
          <span className="text-sys" style={{ fontSize: 8, color: statusColor }}>
            [{status}]
          </span>
        </div>
        <span className="text-sys truncate" style={{ fontSize: 8, color: 'var(--brutal-light-grey)', maxWidth: '90px' }}>
          TX:{msg.sender.slice(0, 6)}
        </span>
      </div>

      {/* Message Body */}
      <p className="text-terminal" style={{ fontSize: 10, color: 'var(--brutal-white)', marginTop: 3, wordBreak: 'break-word', lineHeight: 1.3 }}>
        {'>'} {msg.medicalNeed}
      </p>

      {/* Hazard Banner */}
      {msg.hazard && msg.hazard !== 'None' && msg.hazard !== 'UNPROCESSED' && (
        <div className="flex-row gap-1" style={{ marginTop: 3 }}>
          <span className="text-sys anim-blink-fast" style={{ fontSize: 8, color: 'var(--accent-warn)', background: 'rgba(255, 176, 0, 0.1)', padding: '1px 4px' }}>
            [HAZARD: {msg.hazard}]
          </span>
        </div>
      )}

      {msg.hazard === 'UNPROCESSED' && (
        <span className="text-sys anim-blink" style={{ fontSize: 8, color: 'var(--accent-warn)', marginTop: 2 }}>
          [TRIAGE: UNPROCESSED]
        </span>
      )}

      {/* Expanded Telemetry Details */}
      {isSelected && (
        <div className="flex-col gap-1" style={{ marginTop: 6, paddingTop: 4, borderTop: '1px dashed var(--brutal-light-grey)', background: 'var(--bg-void)', padding: 4 }}>
          <div className="flex-row justify-between">
            <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
              UUID: {msg.id.slice(0, 16)}...
            </span>
            <button
              onClick={handleCopyId}
              className="text-sys"
              style={{ fontSize: 8, color: 'var(--accent-radar)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {copied ? '[COPIED]' : '[COPY_UUID]'}
            </button>
          </div>
          <div className="flex-row justify-between">
            <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
              ORIGIN_NODE: {msg.sender}
            </span>
          </div>
          <div className="flex-row justify-between">
            <span className="text-sys" style={{ fontSize: 8, color: 'var(--brutal-light-grey)' }}>
              TIME: {new Date(msg.timestamp).toISOString()}
            </span>
          </div>

          {/* Action Toolbar */}
          <div className="flex-row gap-1" style={{ marginTop: 4 }}>
            {status !== 'ACKNOWLEDGED' && status !== 'RESOLVED' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateStatus?.(msg.id, 'ACKNOWLEDGED');
                }}
                className="btn text-sys"
                style={{ flex: 1, padding: '3px 0', fontSize: 8, color: 'var(--accent-radar)', borderColor: 'var(--accent-radar)' }}
              >
                [ACKNOWLEDGE]
              </button>
            )}
            {status !== 'RESOLVED' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateStatus?.(msg.id, 'RESOLVED');
                }}
                className="btn text-sys"
                style={{ flex: 1, padding: '3px 0', fontSize: 8, color: 'var(--brutal-white)', borderColor: 'var(--brutal-light-grey)' }}
              >
                [RESOLVE]
              </button>
            )}
            {status === 'RESOLVED' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateStatus?.(msg.id, 'PENDING');
                }}
                className="btn text-sys"
                style={{ flex: 1, padding: '3px 0', fontSize: 8, color: 'var(--accent-warn)', borderColor: 'var(--accent-warn)' }}
              >
                [RE-OPEN]
              </button>
            )}
            {isBaseStation && isAILoaded && onRetriage && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRetriage(msg);
                }}
                className="btn text-sys"
                style={{ width: '85px', padding: '3px 0', fontSize: 8, color: 'var(--accent-radar)' }}
              >
                [AI_TRIAGE]
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

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
  onUpdateMessageStatus?: (id: string, status: TriageStatus) => void;
  onRetriageMessage?: (msg: TriageSOSData) => void;
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
  onUpdateMessageStatus,
  onRetriageMessage,
}: TelemetryPanelProps) {
  const peerCount = Math.max(0, activeNodes - 1);
  const [connectId, setConnectId] = useState('');
  const [signalingIp, setSignalingIp] = useState('');
  const [keyInput, setKeyInput] = useState(encryptionKey);

  const activeFilter = useMessageStore((state) => state.activeFilter);
  const setActiveFilter = useMessageStore((state) => state.setActiveFilter);
  const searchQuery = useMessageStore((state) => state.searchQuery);
  const setSearchQuery = useMessageStore((state) => state.setSearchQuery);
  const selectedMessageId = useMessageStore((state) => state.selectedMessageId);
  const setSelectedMessageId = useMessageStore((state) => state.setSelectedMessageId);

  // Filter & Search computation
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      const status = msg.status || 'PENDING';
      
      // Filter match
      if (activeFilter === 'CRITICAL' && msg.priority !== Priority.CRITICAL) return false;
      if (activeFilter === 'HAZARD' && (!msg.hazard || msg.hazard === 'None' || msg.hazard === 'UNPROCESSED')) return false;
      if (activeFilter === 'UNPROCESSED' && msg.hazard !== 'UNPROCESSED') return false;
      if (activeFilter === 'ACKNOWLEDGED' && status !== 'ACKNOWLEDGED') return false;
      if (activeFilter === 'RESOLVED' && status !== 'RESOLVED') return false;

      // Search match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const textMatch = msg.medicalNeed.toLowerCase().includes(q);
        const senderMatch = msg.sender.toLowerCase().includes(q);
        const hazardMatch = (msg.hazard || '').toLowerCase().includes(q);
        const idMatch = msg.id.toLowerCase().includes(q);
        if (!textMatch && !senderMatch && !hazardMatch && !idMatch) return false;
      }

      return true;
    });
  }, [messages, activeFilter, searchQuery]);

  // Counts for pills
  const counts = useMemo(() => {
    let crit = 0;
    let haz = 0;
    let unproc = 0;
    let ack = 0;
    let res = 0;

    messages.forEach((m) => {
      if (m.priority === Priority.CRITICAL) crit++;
      if (m.hazard && m.hazard !== 'None' && m.hazard !== 'UNPROCESSED') haz++;
      if (m.hazard === 'UNPROCESSED') unproc++;
      if (m.status === 'ACKNOWLEDGED') ack++;
      if (m.status === 'RESOLVED') res++;
    });

    return { all: messages.length, crit, haz, unproc, ack, res };
  }, [messages]);

  const filterTabs: { id: TriageFilter; label: string; count?: number; color?: string }[] = [
    { id: 'ALL', label: 'ALL', count: counts.all },
    { id: 'CRITICAL', label: 'CRIT', count: counts.crit, color: 'var(--accent-crit)' },
    { id: 'HAZARD', label: 'HAZ', count: counts.haz, color: 'var(--accent-warn)' },
    { id: 'UNPROCESSED', label: 'RAW', count: counts.unproc },
    { id: 'ACKNOWLEDGED', label: 'ACK', count: counts.ack, color: 'var(--accent-radar)' },
    { id: 'RESOLVED', label: 'DONE', count: counts.res },
  ];

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

      {/* ── Live Tactical Triage Stream ── */}
      <div className="pane-header">
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--brutal-white)' }}>[TRIAGE_STREAM]</span>
        <span className="text-sys" style={{ fontSize: 9, color: 'var(--accent-radar)' }}>
          {filteredMessages.length}/{messages.length}
        </span>
      </div>

      {/* Filter Tabs */}
      <div
        className="flex-row"
        style={{
          background: 'var(--bg-void)',
          borderBottom: '1px solid var(--brutal-grey)',
          overflowX: 'auto',
          padding: '2px 4px',
          gap: 2,
        }}
      >
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className="text-sys"
              style={{
                background: isActive ? (tab.color || 'var(--accent-radar)') : 'transparent',
                color: isActive ? 'var(--bg-void)' : (tab.color || 'var(--brutal-white)'),
                border: `1px solid ${isActive ? (tab.color || 'var(--accent-radar)') : 'var(--brutal-grey)'}`,
                padding: '2px 4px',
                fontSize: 8,
                fontWeight: 700,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {tab.label}{tab.count !== undefined ? `:${tab.count}` : ''}
            </button>
          );
        })}
      </div>

      {/* Search Bar */}
      <div style={{ padding: '4px 8px', borderBottom: '1px solid var(--brutal-grey)', background: 'var(--brutal-dark-grey)' }}>
        <input
          type="text"
          placeholder="SEARCH (KEYWORD / SENDER / ID)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input-area text-sys"
          style={{ width: '100%', fontSize: 9, padding: '3px 6px' }}
        />
      </div>

      {/* Stream List */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--brutal-dark-grey)' }}>
        {filteredMessages.length === 0 ? (
          <div className="text-sys anim-blink" style={{ padding: 12, fontSize: 9, color: 'var(--brutal-light-grey)', textAlign: 'center' }}>
            {messages.length === 0 ? '[WAITING_FOR_MESH_PACKETS...]' : '[NO_PACKETS_MATCH_FILTER]'}
          </div>
        ) : (
          [...filteredMessages].reverse().map((msg) => (
            <MessageCard
              key={msg.id}
              msg={msg}
              isSelected={selectedMessageId === msg.id}
              onSelect={(id) => setSelectedMessageId(selectedMessageId === id ? null : id)}
              onUpdateStatus={onUpdateMessageStatus}
              onRetriage={onRetriageMessage}
              isBaseStation={nodeRole === 'BASE_STATION'}
              isAILoaded={isAILoaded}
            />
          ))
        )}
      </div>
    </div>
  );
}
