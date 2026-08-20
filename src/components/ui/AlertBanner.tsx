import { memo, useMemo } from 'react';
import { Priority, type TriageSOSData } from '../../network/serialization/Serializer';
import { useMessageStore } from '../../store/useMessageStore';

interface AlertBannerProps {
  onAcknowledge?: (msg: TriageSOSData) => void;
}

export const AlertBanner = memo(function AlertBanner({ onAcknowledge }: AlertBannerProps) {
  const messages = useMessageStore((state) => state.messages);
  const setActiveFilter = useMessageStore((state) => state.setActiveFilter);
  const setSelectedMessageId = useMessageStore((state) => state.setSelectedMessageId);

  const criticalIncidents = useMemo(() => {
    return messages.filter((m) => {
      const isCriticalOrHazard =
        m.priority === Priority.CRITICAL ||
        (m.hazard && m.hazard !== 'None' && m.hazard !== 'UNPROCESSED');
      const isUnresolved = m.status !== 'RESOLVED';
      return isCriticalOrHazard && isUnresolved;
    });
  }, [messages]);

  if (criticalIncidents.length === 0) return null;

  const latest = criticalIncidents[criticalIncidents.length - 1];

  const handleJump = () => {
    setActiveFilter('CRITICAL');
    if (latest) {
      setSelectedMessageId(latest.id);
    }
  };

  const handleAckLatest = () => {
    if (latest && onAcknowledge) {
      onAcknowledge(latest);
    }
  };

  return (
    <div
      className="alert-banner-container anim-alert-pulse flex-row justify-between"
      style={{
        width: '100%',
        padding: '6px 12px',
        background: 'var(--accent-crit)',
        color: 'var(--bg-void)',
        borderBottom: '1px solid var(--brutal-white)',
        fontWeight: 700,
        zIndex: 20,
      }}
    >
      <div className="flex-row gap-2 truncate" style={{ flex: 1, minWidth: 0 }}>
        <span className="anim-blink text-sys" style={{ fontSize: 10, background: 'var(--bg-void)', color: 'var(--accent-crit)', padding: '1px 4px' }}>
          [EMERGENCY_CRIT_SOS]
        </span>
        <span className="text-sys" style={{ fontSize: 10, color: 'var(--bg-void)' }}>
          ({criticalIncidents.length} ACTIVE):
        </span>
        <span className="text-sys truncate" style={{ fontSize: 10, color: 'var(--bg-void)', maxWidth: '400px' }}>
          {latest.medicalNeed}
        </span>
        {latest.hazard && latest.hazard !== 'None' && (
          <span className="text-sys" style={{ fontSize: 9, background: 'var(--bg-void)', color: 'var(--accent-warn)', padding: '1px 4px' }}>
            [{latest.hazard}]
          </span>
        )}
      </div>

      <div className="flex-row gap-2" style={{ flexShrink: 0 }}>
        <button
          onClick={handleJump}
          className="btn-brutal-inverted text-sys"
          style={{
            background: 'var(--bg-void)',
            color: 'var(--brutal-white)',
            border: '1px solid var(--bg-void)',
            padding: '2px 8px',
            fontSize: 9,
            cursor: 'pointer',
          }}
        >
          [INSPECT_LOG]
        </button>
        {latest.status !== 'ACKNOWLEDGED' && (
          <button
            onClick={handleAckLatest}
            className="btn-brutal-inverted text-sys"
            style={{
              background: 'var(--bg-void)',
              color: 'var(--accent-radar)',
              border: '1px solid var(--bg-void)',
              padding: '2px 8px',
              fontSize: 9,
              cursor: 'pointer',
            }}
          >
            [ACK_LATEST]
          </button>
        )}
      </div>
    </div>
  );
});
