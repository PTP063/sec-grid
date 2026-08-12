
import { Priority, type TriageSOSData } from '../../network/serialization/Serializer';

// ─── Priority helpers ─────────────────────────────────────────────────────────

/** Maps numeric enum → display label */
const PRIORITY_LABEL: Record<Priority, string> = {
  [Priority.LOW]: 'LOW',
  [Priority.HIGH]: 'HIGH',
  [Priority.CRITICAL]: 'CRIT',
};

/** Maps numeric enum → CSS color string */
const PRIORITY_COLOR: Record<Priority, string> = {
  [Priority.LOW]: '#4ade80',   /* emerald/green-400 */
  [Priority.HIGH]: '#fb923c',   /* orange-400        */
  [Priority.CRITICAL]: '#f87171',   /* red-400           */
};

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Compact monospace progress bar. */
function AIProgressBar({ progress, isLoaded, isMockMode, error }: {
  progress: number;
  isLoaded: boolean;
  isMockMode?: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="metric-value text-[9px] text-red-400 font-bold uppercase truncate" title={error}>
          ⚠ {error}
        </span>
      </div>
    );
  }
  if (isLoaded) {
    return (
      <div className="flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${isMockMode ? 'bg-orange-400' : 'bg-emerald-400'} animate-neon-pulse`} />
        <span className={`metric-value text-[9px] ${isMockMode ? 'text-orange-400' : 'text-emerald-400'} font-bold tracking-wider`}>
          {isMockMode ? 'AI READY (MOCK)' : 'AI READY'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="metric-value text-[9px] text-zinc-500 uppercase tracking-widest">WebLLM</span>
        <span className="metric-value text-[9px] text-cyan-400">{progress}%</span>
      </div>
      <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300 animate-progress"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #06b6d4, #22d3ee)',
            boxShadow: '0 0 6px rgba(34,211,238,0.6)',
          }}
        />
      </div>
    </div>
  );
}

/** Single row in the SOS message table. */
function SOSRow({ msg }: { msg: TriageSOSData }) {
  const color = PRIORITY_COLOR[msg.priority];
  const label = PRIORITY_LABEL[msg.priority];

  return (
    <div className="animate-slide-in flex flex-col gap-0.5 py-1.5 border-b border-zinc-800/40 last:border-b-0">
      <div className="flex items-center gap-2">
        {/* Priority badge */}
        <span
          className="metric-value text-[8px] font-bold px-1 py-0.5 rounded border shrink-0"
          style={{ color, borderColor: color, background: `${color}14` }}
        >
          {label}
        </span>
        {/* UUID truncated */}
        <span className="metric-value text-[8px] text-zinc-600 truncate flex-1" title={msg.id}>
          {msg.id.slice(0, 12)}
        </span>
        {/* Timestamp */}
        <span className="metric-value text-[8px] text-zinc-600 shrink-0">{formatTs(msg.timestamp)}</span>
      </div>
      {/* Medical need */}
      <p className="font-mono text-[9px] text-zinc-300 leading-snug line-clamp-2 pl-0.5">
        {msg.medicalNeed}
      </p>
      {/* Hazard — only when present */}
      {msg.hazard && msg.hazard !== 'None' && (
        <p className="metric-value text-[8px] text-orange-400/70 truncate pl-0.5">
          ⚠ {msg.hazard.slice(0, 50)}
        </p>
      )}
    </div>
  );
}

// ─── TelemetryPanel ───────────────────────────────────────────────────────────

export interface TelemetryPanelProps {
  /** Total number of nodes (self + peers) visible in the mesh graph. */
  activeNodes: number;
  /** AI model loading progress 0–100. */
  aiProgress: number;
  /** Whether the AI model is fully loaded and ready. */
  isAILoaded: boolean;
  /** True if we failed to fetch the real model and fell back to mock mode. */
  isMockMode?: boolean;
  /** Non-null when a WebGPU/load error occurred. */
  aiError: string | null;
  /** Decoded TriageSOSData messages received (or sent) by this tab. */
  messages: TriageSOSData[];
  /**
   * Human-readable Protobuf compression metric, e.g. "Saved 87.2% bandwidth".
   * Computed in App.tsx after each successful encode and passed down.
   */
  compressionMetric: string;
}

/**
 * Glassmorphic floating telemetry panel anchored to `bottom-6 right-6`.
 *
 * Displays:
 *  - Active node count + peer delta
 *  - AI progress bar (from Phase 3)
 *  - Protobuf compression badge (from Phase 2)
 *  - High-density SOS message table with priority colour-coding
 */
export function TelemetryPanel({
  activeNodes,
  aiProgress,
  isAILoaded,
  isMockMode,
  aiError,
  messages,
  compressionMetric,
}: TelemetryPanelProps) {
  const peerCount = Math.max(0, activeNodes - 1);

  return (
    <div
      className="absolute bottom-6 right-6 z-10 flex flex-col gap-2.5 p-3 w-[280px]"
      style={{
        background: 'rgba(9,9,11,0.82)',   /* zinc-950/82 */
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: '1px solid rgba(39,39,42,0.8)',   /* zinc-800/80 */
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/50">
        <span className="metric-value text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
          MESH TELEMETRY
        </span>
        <span
          className="ml-auto metric-value text-[7px] font-bold px-1.5 py-0.5 rounded-full border"
          style={{ color: '#22d3ee', borderColor: 'rgba(34,211,238,0.4)', background: 'rgba(34,211,238,0.06)' }}
        >
          OFFLINE-P2P
        </span>
      </div>

      {/* ── Stats row ── */}
      <div className="grid grid-cols-3 gap-1.5">
        {/* Active nodes */}
        <div className="flex flex-col gap-0.5 p-1.5 rounded bg-zinc-900/60 border border-zinc-800/40">
          <span className="metric-value text-[7px] text-zinc-600 uppercase tracking-widest">Nodes</span>
          <span className="metric-value text-base font-bold text-cyan-400 leading-none">{activeNodes}</span>
        </div>
        {/* Peers */}
        <div className="flex flex-col gap-0.5 p-1.5 rounded bg-zinc-900/60 border border-zinc-800/40">
          <span className="metric-value text-[7px] text-zinc-600 uppercase tracking-widest">Peers</span>
          <span className={`metric-value text-base font-bold leading-none ${peerCount > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
            {peerCount}
          </span>
        </div>
        {/* SOS received */}
        <div className="flex flex-col gap-0.5 p-1.5 rounded bg-zinc-900/60 border border-zinc-800/40">
          <span className="metric-value text-[7px] text-zinc-600 uppercase tracking-widest">SOS</span>
          <span className={`metric-value text-base font-bold leading-none ${messages.length > 0 ? 'text-orange-400' : 'text-zinc-600'}`}>
            {messages.length}
          </span>
        </div>
      </div>

      {/* ── AI progress ── */}
      <div className="p-2 rounded bg-zinc-900/60 border border-zinc-800/40">
        <AIProgressBar progress={aiProgress} isLoaded={isAILoaded} isMockMode={isMockMode} error={aiError} />
      </div>

      {/* ── Protobuf compression badge ── */}
      {compressionMetric && (
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded border"
          style={{ border: '1px solid rgba(34,211,238,0.2)', background: 'rgba(34,211,238,0.04)' }}
        >
          <span className="metric-value text-[8px] text-zinc-500 uppercase tracking-widest shrink-0">
            Proto3
          </span>
          <span className="metric-value text-[9px] text-cyan-400 font-bold truncate" title={compressionMetric}>
            ⚡ {compressionMetric}
          </span>
        </div>
      )}

      {/* ── SOS message table ── */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="metric-value text-[8px] text-zinc-600 uppercase tracking-widest">
            Received SOS
          </span>
          {messages.length > 0 && (
            <span className="metric-value text-[8px] text-zinc-600">{messages.length} total</span>
          )}
        </div>

        <div
          className="flex flex-col overflow-y-auto"
          style={{ maxHeight: 196 }}
        >
          {messages.length === 0 ? (
            <p className="metric-value text-[9px] text-zinc-700 text-center py-3">
              — awaiting transmissions —
            </p>
          ) : (
            [...messages].reverse().map((msg) => (
              <SOSRow key={msg.id} msg={msg} />
            ))
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <p className="metric-value text-[7px] text-zinc-700 text-center pt-1 border-t border-zinc-800/40 leading-relaxed">
        P1:BroadcastChannel · P2:Protobuf · P3:WebLLM · P4:ReactFlow
      </p>
    </div>
  );
}
