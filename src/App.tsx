import { useState, useCallback, useEffect, useRef } from 'react';

// Phase 1 — MeshNode singleton via the visualizer hook
import { useMeshVisualizer } from './hooks/useMeshVisualizer';
import type { NetworkPacket } from './network/types';

// Phase 2 — Protobuf serializer (module-level singletons via initSerializer)
import {
  initSerializer,
  encodeTriage,
  decodeTriage,
  getCompressionRatio,
  type TriageSOSData,
  Priority,
} from './network/serialization/Serializer';

// Phase 3 — On-device WebLLM via singleton hook
import { useAI } from './ai/useAI';

// Phase 4 — ReactFlow canvas
import { MeshGraph } from './components/network/MeshGraph';

// Phase 5 — Telemetry panel
import { TelemetryPanel } from './components/ui/TelemetryPanel';

// ─── App ──────────────────────────────────────────────────────────────────────

/**
 * Master controller — wires Phase 1–4 into a unified Command Center UI.
 *
 * Singleton ownership:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  MeshNode     → owned by useMeshVisualizer (useRef inside hook)  │
 * │  AIProcessor  → owned by useAI → AIProcessor.getInstance()       │
 * │  Serializer   → module-level state, initialized once via useRef  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Layout:
 *   Full-screen ReactFlow canvas (background)
 *   └─ Bottom-left:  SOS terminal input
 *   └─ Bottom-right: TelemetryPanel (glassmorphic, absolute positioned)
 */
export default function App() {

  // ── Phase 1: MeshNode (singleton owned by hook) ───────────────────────────
  const { meshNode, nodes, edges } = useMeshVisualizer();

  // ── Phase 2: Protobuf serializer init ─────────────────────────────────────
  // useRef guards the idempotency — React StrictMode may call effects twice.
  const serializerInitialized = useRef(false);

  useEffect(() => {
    if (serializerInitialized.current) return;
    serializerInitialized.current = true;
    initSerializer().catch((err) =>
      console.error('[App] Serializer init failed:', err)
    );
  }, []);

  // ── Phase 3: WebLLM (singleton managed inside useAI) ──────────────────────
  const {
    isLoaded: isAILoaded,
    isMockMode,
    loadingProgress: aiProgress,
    error: aiError,
    loadModel,
    processMessage,
  } = useAI();

  // ── App-level state ───────────────────────────────────────────────────────
  const [messages, setMessages] = useState<TriageSOSData[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [compressionMetric, setCompression] = useState('');

  // ── Receive handler ───────────────────────────────────────────────────────
  // Subscribed once on mount; meshNode is a stable ref.
  useEffect(() => {
    const unsub = meshNode.onMessage((packet: NetworkPacket<unknown>) => {
      if (packet.header.type !== 'DATA') return;

      try {
        const raw = packet.payload;

        // Fast path — already a plain TriageSOSData object (no Protobuf wrapper)
        if (raw && typeof raw === 'object' && 'medicalNeed' in (raw as object)) {
          setMessages((prev) => [...prev, raw as TriageSOSData]);
          return;
        }

        // Protobuf path — reconstruct Uint8Array from structured-clone artifact
        const bytes = raw instanceof Uint8Array
          ? raw
          : new Uint8Array(Object.values(raw as Record<string, number>));

        const decoded = decodeTriage(bytes);
        setMessages((prev) => [...prev, decoded]);
      } catch (err) {
        console.warn('[App] Decode error on incoming packet:', err);
      }
    });

    return unsub;
  }, [meshNode]);

  // ── Send SOS handler ──────────────────────────────────────────────────────
  const handleSendSOS = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setIsSending(true);
    setInputText('');

    try {
      // Step 1 — AI inference (or raw text fallback)
      let triageData: TriageSOSData;

      if (isAILoaded) {
        const result = await processMessage(text);
        triageData = result ?? {
          id: crypto.randomUUID(),
          sender: meshNode.id,
          priority: Priority.LOW,
          medicalNeed: text.slice(0, 120),
          hazard: 'None',
          timestamp: Date.now(),
        };
      } else {
        triageData = {
          id: crypto.randomUUID(),
          sender: meshNode.id,
          priority: Priority.LOW,
          medicalNeed: text.slice(0, 120),
          hazard: 'None',
          timestamp: Date.now(),
        };
      }

      // Always stamp with this tab's node ID
      triageData = { ...triageData, sender: meshNode.id };

      // Step 2 — Encode to Protobuf binary + compute compression metric
      let payload: Uint8Array | TriageSOSData = triageData;
      try {
        const binary = encodeTriage(triageData);
        const jsonStr = JSON.stringify(triageData);
        const metric = getCompressionRatio(jsonStr, binary);
        setCompression(metric);
        payload = binary;
      } catch (encErr) {
        console.warn('[App] Protobuf encode failed — sending raw object:', encErr);
      }

      // Step 3 — Broadcast via Phase 1 BroadcastChannel mesh
      meshNode.broadcast(payload, 'DATA');

      // Surface sent message in our own list immediately
      setMessages((prev) => [...prev, triageData]);
    } catch (err) {
      console.error('[App] sendSOS pipeline error:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, isAILoaded, processMessage, meshNode]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendSOS();
    }
  }, [handleSendSOS]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    // Full-screen dot-grid container
    <div className="dot-grid w-full h-screen overflow-hidden relative">

      {/* ── Phase 4: ReactFlow canvas — fills the entire background ── */}
      <MeshGraph externalNodes={nodes} externalEdges={edges} />

      {/* ── SOS input terminal — bottom-left floating ── */}
      <div
        className="absolute bottom-6 left-6 z-10 flex flex-col gap-2"
        style={{
          width: 280,
          background: 'rgba(9,9,11,0.82)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(39,39,42,0.8)',
          borderRadius: 10,
          padding: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* Terminal header */}
        <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/50">
          <span className="metric-value text-[9px] text-zinc-600 font-bold uppercase tracking-widest">
            SOS Terminal
          </span>
          <span
            className="ml-auto metric-value text-[7px] px-1.5 py-0.5 rounded-full border"
            style={{
              color: isAILoaded ? '#4ade80' : '#52525b',
              borderColor: isAILoaded ? 'rgba(74,222,128,0.4)' : '#3f3f46',
              background: isAILoaded ? 'rgba(74,222,128,0.06)' : 'transparent',
            }}
          >
            {isAILoaded ? (isMockMode ? '● AI (MOCK)' : '● AI ONLINE') : '○ AI OFFLINE'}
          </span>
        </div>

        {/* Load AI button — shown only before model loads */}
        {!isAILoaded && !aiError && aiProgress === 0 && (
          <button
            type="button"
            onClick={loadModel}
            className="w-full py-1 rounded metric-value text-[9px] font-bold uppercase tracking-widest text-emerald-400 border border-emerald-400/30 bg-emerald-400/5 hover:bg-emerald-400/10 transition-colors"
          >
            Load AI Model
          </button>
        )}

        {/* AI loading progress inline */}
        {!isAILoaded && aiProgress > 0 && (
          <div className="flex flex-col gap-0.5">
            <div className="w-full h-1 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full animate-progress"
                style={{
                  width: `${aiProgress}%`,
                  background: 'linear-gradient(90deg, #06b6d4, #22d3ee)',
                  boxShadow: '0 0 5px rgba(34,211,238,0.55)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span className="metric-value text-[8px] text-zinc-600">{aiProgress}% loaded</span>
          </div>
        )}

        {/* WebGPU error */}
        {aiError && (
          <p className="metric-value text-[8px] text-red-400/80">⚠ {aiError.slice(0, 80)}</p>
        )}

        {/* Textarea */}
        <textarea
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          placeholder="Type SOS message… (Enter to send)"
          className="w-full rounded bg-zinc-950 border border-zinc-800/60 text-zinc-200 text-[10px] placeholder-zinc-700 p-2 resize-none focus:outline-none focus:border-cyan-500/40 focus:ring-1 focus:ring-cyan-500/10 transition-colors metric-value disabled:opacity-40"
        />

        {/* Send button */}
        <button
          type="button"
          onClick={handleSendSOS}
          disabled={isSending || !inputText.trim()}
          className="w-full py-1.5 rounded metric-value text-[10px] font-bold tracking-widest uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: isSending ? 'rgba(34,211,238,0.06)' : 'linear-gradient(135deg,rgba(34,211,238,0.15),rgba(34,211,238,0.06))',
            border: '1px solid rgba(34,211,238,0.35)',
            color: '#22d3ee',
            boxShadow: isSending ? 'none' : '0 0 10px rgba(34,211,238,0.07)',
          }}
        >
          {isSending ? '⟳  Processing…' : '⚡  Broadcast SOS'}
        </button>

        {/* Node ID watermark */}
        <p className="metric-value text-[7px] text-zinc-700 truncate" title={meshNode.id}>
          id:{meshNode.id}
        </p>
      </div>

      {/* ── Phase 5: Telemetry panel — bottom-right ── */}
      <TelemetryPanel
        activeNodes={nodes.length}
        aiProgress={aiProgress}
        isAILoaded={isAILoaded}
        isMockMode={isMockMode}
        aiError={aiError}
        messages={messages}
        compressionMetric={compressionMetric}
      />

    </div>
  );
}
