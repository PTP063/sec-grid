import { useCallback, useEffect, useRef, useState } from 'react';
import { useMeshStore } from './store/useMeshStore';
import { useMessageStore } from './store/useMessageStore';
import { useMeshVisualizer } from './hooks/useMeshVisualizer';
import type { NetworkPacket } from './network/types';
import {
  initSerializer,
  encodeTriage,
  decodeTriage,
  getCompressionRatio,
  type TriageSOSData,
  type TriageStatus,
  Priority,
} from './network/serialization/Serializer';
import { evaluateEmergencyTriage } from './triage/DeterministicTriage';
import { MeshGraph } from './components/network/MeshGraph';
import { TelemetryPanel } from './components/ui/TelemetryPanel';
import { AlertBanner } from './components/ui/AlertBanner';
import { TacticalTriageHUD } from './components/ui/TacticalTriageHUD';
import { playTacticalAlert, playAckChirp, playResolvedChime } from './utils/audio';
import { toggleSentryMode, onWakeLockChange } from './utils/lifecycle';

export default function App() {
  const {
    meshNode,
    metadataList,
    peerjsId,
    nodeRole,
    encryptionKey,
    initMesh,
    destroyMesh,
    connectToPeer,
    setNodeRole,
    setEncryptionKey,
  } = useMeshStore();

  const { nodes, edges } = useMeshVisualizer();

  const messages = useMessageStore((state) => state.messages);
  const compressionMetric = useMessageStore((state) => state.compressionMetric);
  const addOrUpdateMessage = useMessageStore((state) => state.addOrUpdateMessage);
  const updateMessageStatus = useMessageStore((state) => state.updateMessageStatus);
  const audioEnabled = useMessageStore((state) => state.audioEnabled);
  const toggleAudio = useMessageStore((state) => state.toggleAudio);

  const [isSending, setIsSending] = useState(false);
  const [isSentryActive, setIsSentryActive] = useState(false);

  useEffect(() => {
    return onWakeLockChange((active) => setIsSentryActive(active));
  }, []);

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

  // Listen for incoming mesh data packets
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
          const bytes =
            raw instanceof Uint8Array
              ? raw
              : new Uint8Array(Object.values(raw as Record<string, number>));
          decoded = decodeTriage(bytes);
        }

        // Lazy migration for legacy UNPROCESSED frames
        if (decoded.hazard === 'UNPROCESSED' || decoded.triageMethod === undefined) {
          const evalResult = evaluateEmergencyTriage(decoded.medicalNeed);
          decoded = {
            ...decoded,
            priority: decoded.hazard === 'UNPROCESSED' ? evalResult.priority : decoded.priority,
            hazard: decoded.hazard === 'UNPROCESSED' ? evalResult.hazard : decoded.hazard,
            triageMethod: evalResult.triageMethod,
          };
        }

        addOrUpdateMessage(decoded);

        // Sound tactical alert for critical incoming packets
        if (useMessageStore.getState().audioEnabled) {
          const isCrit = decoded.priority === Priority.CRITICAL;
          const hasHazard = decoded.hazard && decoded.hazard !== 'None';
          if (isCrit || hasHazard) {
            playTacticalAlert();
          }
        }
      } catch (err) {
        console.warn('[App] Decode error on incoming packet:', err);
      }
    });

    return unsub;
  }, [meshNode, addOrUpdateMessage]);

  // Broadcast triage packet across the mesh
  const handleBroadcastTriage = useCallback(
    (sosData: TriageSOSData) => {
      if (!meshNode) return;
      setIsSending(true);

      try {
        let payload: Uint8Array | TriageSOSData = sosData;
        try {
          const binary = encodeTriage(sosData);
          const jsonStr = JSON.stringify(sosData);
          const metric = getCompressionRatio(jsonStr, binary);
          useMessageStore.getState().setCompressionMetric(metric);
          payload = binary;
        } catch (_encErr) {
          console.warn('[App] Protobuf encode failed — sending raw object:', _encErr);
        }

        meshNode.broadcast(payload, 'DATA');
        addOrUpdateMessage(sosData);

        if (audioEnabled) {
          playAckChirp();
        }
      } catch (err) {
        console.error('[App] handleBroadcastTriage error:', err);
      } finally {
        setIsSending(false);
      }
    },
    [meshNode, addOrUpdateMessage, audioEnabled]
  );

  const handleUpdateStatus = useCallback(
    (id: string, status: TriageStatus) => {
      const updated = updateMessageStatus(id, status);
      if (!updated || !meshNode) return;

      // Broadcast status sync across the mesh
      try {
        const binary = encodeTriage(updated);
        meshNode.broadcast(binary, 'DATA');
      } catch {
        meshNode.broadcast(updated, 'DATA');
      }

      if (audioEnabled) {
        if (status === 'ACKNOWLEDGED') playAckChirp();
        if (status === 'RESOLVED') playResolvedChime();
      }
    },
    [updateMessageStatus, meshNode, audioEnabled]
  );

  const handleRetriageMessage = useCallback(
    (msg: TriageSOSData) => {
      if (!meshNode) return;
      try {
        const evalResult = evaluateEmergencyTriage(msg.medicalNeed);
        const triaged: TriageSOSData = {
          ...msg,
          priority: evalResult.priority,
          hazard: evalResult.hazard,
          triageMethod: evalResult.triageMethod,
        };

        try {
          const binary = encodeTriage(triaged);
          meshNode.broadcast(binary, 'DATA');
        } catch {
          meshNode.broadcast(triaged, 'DATA');
        }

        addOrUpdateMessage(triaged);
      } catch (err) {
        console.error('[App] Re-triage error:', err);
      }
    },
    [meshNode, addOrUpdateMessage]
  );

  if (!meshNode) return null;

  return (
    <div className="layout-dashboard grid-bg brutal-shadow">
      {/* ── HEADER ── */}
      <div
        style={{ gridArea: 'header', borderBottom: '1px solid var(--brutal-grey)', padding: '0 16px' }}
        className="flex-row justify-between bg-void"
      >
        <div className="flex-row gap-2">
          <span className="text-sys" style={{ fontSize: 11, color: 'var(--accent-radar)' }}>
            SYS.VER.4.2.0 // MESH_NODES: {metadataList.length} // ROLE: {nodeRole}
          </span>
        </div>
        <div className="flex-row gap-3">
          <button
            type="button"
            onClick={toggleSentryMode}
            className="text-sys"
            style={{
              background: 'none',
              border: `1px solid ${isSentryActive ? 'var(--accent-radar)' : 'var(--brutal-light-grey)'}`,
              color: isSentryActive ? 'var(--accent-radar)' : 'var(--brutal-light-grey)',
              fontSize: 9,
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            [SENTRY: {isSentryActive ? 'ACTIVE (WAKE LOCK)' : 'STANDBY'}]
          </button>
          <button
            type="button"
            onClick={toggleAudio}
            className="text-sys"
            style={{
              background: 'none',
              border: `1px solid ${audioEnabled ? 'var(--accent-radar)' : 'var(--brutal-light-grey)'}`,
              color: audioEnabled ? 'var(--accent-radar)' : 'var(--brutal-light-grey)',
              fontSize: 9,
              padding: '2px 6px',
              cursor: 'pointer',
            }}
          >
            [AUDIO: {audioEnabled ? 'ACTIVE' : 'MUTED'}]
          </button>
          <span className="text-sys" style={{ fontSize: 11, color: 'var(--brutal-white)' }}>
            ENCRYPTION: SECP256K1 // NODE_ID: {meshNode.id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* ── SIDEBAR (TELEMETRY / TERMINAL) ── */}
      <div style={{ gridArea: 'sidebar', borderRight: '1px solid var(--brutal-grey)', overflow: 'hidden' }}>
        <TelemetryPanel
          activeNodes={metadataList.length}
          aiProgress={100}
          isAILoaded={true}
          isMockMode={false}
          aiError={null}
          messages={messages}
          compressionMetric={compressionMetric}
          peerjsId={peerjsId}
          onConnectPeer={connectToPeer}
          loadModel={() => {}}
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
          onUpdateMessageStatus={handleUpdateStatus}
          onRetriageMessage={handleRetriageMessage}
        />
      </div>

      {/* ── MAIN (REACT FLOW MESH GRAPH & ALERT BANNER) ── */}
      <div style={{ gridArea: 'main', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <AlertBanner onAcknowledge={(msg) => handleUpdateStatus(msg.id, 'ACKNOWLEDGED')} />
        <div style={{ flex: 1, position: 'relative' }}>
          <MeshGraph externalNodes={nodes} externalEdges={edges} />
        </div>
      </div>

      {/* ── BOTTOM (TACTICAL TRIAGE HUD) ── */}
      <div className="pane" style={{ gridArea: 'bottom', borderTop: '1px solid var(--brutal-grey)' }}>
        <div className="pane-header">
          <span className="text-sys" style={{ fontSize: 10, color: 'var(--accent-radar)' }}>
            [TX_BUFFER] TACTICAL EMERGENCY TRIAGE (START / SALT)
          </span>
        </div>

        <TacticalTriageHUD
          senderId={meshNode.id}
          isSending={isSending}
          nodeRole={nodeRole}
          onSubmit={handleBroadcastTriage}
        />
      </div>

      {/* ── FOOTER ── */}
      <div
        style={{ gridArea: 'footer', borderTop: '1px solid var(--brutal-grey)', padding: '0 16px' }}
        className="flex-row justify-between bg-void"
      >
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--brutal-white)' }}>
          LATENCY: &lt;42ms // GOSSIP: EPIDEMIC // TRIAGE: DETERMINISTIC
        </span>
        <span className="text-sys" style={{ fontSize: 11, color: 'var(--accent-radar)' }}>
          CONNECTION: BROADCAST_CHANNEL // PROTOBUF
        </span>
      </div>
    </div>
  );
}
