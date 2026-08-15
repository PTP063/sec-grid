import { useCallback, useEffect, useRef, useState } from 'react';
import { useMeshStore } from './store/useMeshStore';
import { useMessageStore } from './store/useMessageStore';
import { useAIStore } from './store/useAIStore';
import { useMeshVisualizer } from './hooks/useMeshVisualizer';
import type { NetworkPacket } from './network/types';
import {
  initSerializer,
  encodeTriage,
  decodeTriage,
  getCompressionRatio,
  type TriageSOSData,
  Priority,
} from './network/serialization/Serializer';
import { MeshGraph } from './components/network/MeshGraph';
import { TelemetryPanel } from './components/ui/TelemetryPanel';

export default function App() {
  const { meshNode, metadataList, peerjsId, nodeRole, encryptionKey, initMesh, destroyMesh, connectToPeer, setNodeRole, setEncryptionKey } = useMeshStore();
  const { nodes, edges } = useMeshVisualizer();

  const messages = useMessageStore((state) => state.messages);
  const compressionMetric = useMessageStore((state) => state.compressionMetric);
  const addOrUpdateMessage = useMessageStore((state) => state.addOrUpdateMessage);
  
  const isAILoaded = useAIStore((state) => state.isLoaded);
  const isMockMode = useAIStore((state) => state.isMockMode);
  const aiProgress = useAIStore((state) => state.loadingProgress);
  const aiError = useAIStore((state) => state.error);
  const loadModel = useAIStore((state) => state.loadModel);
  const processMessage = useAIStore((state) => state.processMessage);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    // Automatically use the host IP for the signaling server so devices on Wi-Fi discover each other natively
    initMesh({ host: window.location.hostname, port: 9000, path: '/mesh' });
  }, [initMesh]);

  useEffect(() => {
    useMessageStore.getState().initWAL();
  }, []);

  const serializerInitialized = useRef(false);
  useEffect(() => {
    if (serializerInitialized.current) return;
    serializerInitialized.current = true;
    initSerializer().catch((err) => console.error('[App] Serializer init failed:', err));
  }, []);

  useEffect(() => {
    if (!meshNode) return;
    const unsub = meshNode.onMessage((packet: NetworkPacket<unknown>) => {
      if (packet.header.type !== 'DATA') return;

      try {
        const raw = packet.payload;
        let decoded: TriageSOSData;

        if (raw && typeof raw === 'object' && 'medicalNeed' in (raw as object)) {
          decoded = raw as TriageSOSData;
        } else {
          const bytes = raw instanceof Uint8Array
            ? raw
            : new Uint8Array(Object.values(raw as Record<string, number>));
          decoded = decodeTriage(bytes);
        }

        addOrUpdateMessage(decoded);

        const currentState = useAIStore.getState();
        const { nodeRole } = useMeshStore.getState();
        if (decoded.hazard === 'UNPROCESSED' && currentState.isLoaded && nodeRole === 'BASE_STATION') {
          currentState.processMessage(decoded.medicalNeed).then((result) => {
            if (result) {
              const triaged: TriageSOSData = {
                ...result,
                id: decoded.id,
                sender: decoded.sender,
                timestamp: decoded.timestamp,
              };
              
              try {
                const binary = encodeTriage(triaged);
                meshNode.broadcast(binary, 'DATA');
              } catch (_encErr) {
                meshNode.broadcast(triaged, 'DATA');
              }
              
              addOrUpdateMessage(triaged);
            }
          });
        }
      } catch (err) {
        console.warn('[App] Decode error on incoming packet:', err);
      }
    });

    return unsub;
  }, [meshNode, addOrUpdateMessage]);

  const handleSendSOS = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending || !meshNode) return;

    setIsSending(true);
    setInputText('');

    try {
      let triageData: TriageSOSData;

      if (isAILoaded && nodeRole === 'BASE_STATION') {
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
          hazard: 'UNPROCESSED',
          timestamp: Date.now(),
        };
      }

      triageData = { ...triageData, sender: meshNode.id };

      let payload: Uint8Array | TriageSOSData = triageData;
      try {
        const binary = encodeTriage(triageData);
        const jsonStr = JSON.stringify(triageData);
        const metric = getCompressionRatio(jsonStr, binary);
        useMessageStore.getState().setCompressionMetric(metric);
        payload = binary;
      } catch (_encErr) {
        console.warn('[App] Protobuf encode failed — sending raw object:', _encErr);
      }

      meshNode.broadcast(payload, 'DATA');
      addOrUpdateMessage(triageData);
    } catch (err) {
      console.error('[App] sendSOS pipeline error:', err);
    } finally {
      setIsSending(false);
    }
  }, [inputText, isSending, isAILoaded, processMessage, meshNode, addOrUpdateMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendSOS();
    }
  }, [handleSendSOS]);

  if (!meshNode) return null;

  return (
    <div className="layout-dashboard grid-bg brutal-shadow">
      
      {/* ── HEADER ── */}
      <div style={{ gridArea: 'header', borderBottom: '1px solid var(--brutal-grey)', padding: '0 16px' }} className="flex-row justify-between bg-void">
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--accent-radar)' }}>SYS.VER.4.0.2 // MESH_NODES: {metadataList.length} // ROLE: {nodeRole}</span>
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--brutal-white)' }}>ENCRYPTION: SECP256K1 // NODE_ID: {meshNode.id.slice(0,8)}</span>
      </div>

      {/* ── SIDEBAR (TELEMETRY / TERMINAL) ── */}
      <div style={{ gridArea: 'sidebar', borderRight: '1px solid var(--brutal-grey)', overflow: 'hidden' }}>
        <TelemetryPanel
          activeNodes={metadataList.length}
          aiProgress={aiProgress}
          isAILoaded={isAILoaded}
          isMockMode={isMockMode}
          aiError={aiError}
          messages={messages}
          compressionMetric={compressionMetric}
          peerjsId={peerjsId}
          onConnectPeer={connectToPeer}
          loadModel={loadModel}
          nodeRole={nodeRole}
          onRoleToggle={setNodeRole}
          onSetSignaling={(ip) => {
            destroyMesh();
            initMesh({ host: ip, port: 9000, path: '/mesh' });
          }}
          encryptionKey={encryptionKey}
          onSetEncryptionKey={(key) => {
            setEncryptionKey(key);
            destroyMesh();
            initMesh();
          }}
        />
      </div>

      {/* ── MAIN (REACT FLOW MESH GRAPH) ── */}
      <div style={{ gridArea: 'main', position: 'relative' }}>
        <MeshGraph externalNodes={nodes} externalEdges={edges} />
      </div>

      {/* ── BOTTOM (TRIAGE INPUT FORM) ── */}
      <div className="pane" style={{ gridArea: 'bottom', borderTop: '1px solid var(--brutal-grey)' }}>
        <div className="pane-header">
          <span className="text-sys" style={{ fontSize: 10, color: 'var(--accent-radar)' }}>[TX_BUFFER] TRIAGE FORM</span>
        </div>
        <div className="flex-row gap-2" style={{ padding: 8, height: '100%' }}>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            placeholder="ENTER SOS PAYLOAD... (ENTER TO TX)"
            className="input-area text-sys"
            style={{ height: '100%', flex: 1, border: '1px solid var(--brutal-light-grey)' }}
          />
          <button
            type="button"
            onClick={handleSendSOS}
            disabled={isSending || !inputText.trim()}
            className="btn"
            style={{ width: '120px', height: '100%' }}
          >
            {isSending ? '[TX_ACTIVE]' : '[BROADCAST]'}
          </button>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ gridArea: 'footer', borderTop: '1px solid var(--brutal-grey)', padding: '0 16px' }} className="flex-row justify-between bg-void">
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--brutal-white)' }}>LATENCY: &lt;42ms // GOSSIP: EPIDEMIC</span>
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--accent-radar)' }}>CONNECTION: BROADCAST_CHANNEL // PROTOBUF</span>
      </div>

    </div>
  );
}
