import { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  Priority,
  type HazardCategory,
  evaluateEmergencyTriage,
  type TriageResult,
} from '../../triage/DeterministicTriage';
import type { TriageSOSData } from '../../network/Serializer';
import { QuickMacros } from './QuickMacros';

interface TacticalTriageHUDProps {
  senderId: string;
  isSending: boolean;
  nodeRole?: string;
  onSubmit: (sos: TriageSOSData) => void;
}

const HAZARD_BUTTONS: Array<{ id: HazardCategory; label: string; icon: string; color: string }> = [
  { id: 'FIRE', label: 'FIRE', icon: '🔥', color: 'var(--accent-crit)' },
  { id: 'COLLAPSE', label: 'COLLAPSE', icon: '🏚️', color: 'var(--accent-warn)' },
  { id: 'GAS_LEAK', label: 'GAS', icon: '☣️', color: 'var(--accent-warn)' },
  { id: 'LIVE_WIRE', label: 'WIRE', icon: '⚡', color: 'var(--accent-crit)' },
  { id: 'FLOOD', label: 'FLOOD', icon: '🌊', color: 'var(--accent-radar)' },
];

export const TacticalTriageHUD = memo(function TacticalTriageHUD({
  senderId,
  isSending,
  nodeRole,
  onSubmit,
}: TacticalTriageHUDProps) {
  const [manualPriority, setManualPriority] = useState<Priority>(Priority.LOW);
  const [selectedHazards, setSelectedHazards] = useState<Set<HazardCategory>>(new Set());
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<TriageResult>(() =>
    evaluateEmergencyTriage('', { manualPriority: Priority.LOW })
  );

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 120ms debounced preview calculation for reactive badge updates
  const runEvaluation = useCallback(
    (inputText: string, priority: Priority, hazards: Set<HazardCategory>) => {
      const firstHazard = hazards.size > 0 ? Array.from(hazards)[0] : undefined;
      const isResponder = nodeRole === 'BASE_STATION';
      const result = evaluateEmergencyTriage(inputText, {
        manualPriority: priority,
        manualHazard: firstHazard,
        isResponder,
        responderId: isResponder ? senderId : undefined,
      });
      setPreview(result);
    },
    [nodeRole, senderId]
  );

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      runEvaluation(text, manualPriority, selectedHazards);
    }, 120);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [text, manualPriority, selectedHazards, runEvaluation]);

  const toggleHazard = (hazard: HazardCategory) => {
    setSelectedHazards((prev) => {
      const next = new Set(prev);
      if (next.has(hazard)) next.delete(hazard);
      else next.add(hazard);
      return next;
    });
  };

  const handleSubmit = useCallback(() => {
    if (isSending) return;

    // Immediate synchronous evaluation: bypass any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const firstHazard = selectedHazards.size > 0 ? Array.from(selectedHazards)[0] : undefined;
    const isResponder = nodeRole === 'BASE_STATION';
    const evalResult = evaluateEmergencyTriage(text, {
      manualPriority,
      manualHazard: firstHazard,
      isResponder,
      responderId: isResponder ? senderId : undefined,
    });

    // Merge any additional manually toggled hazards
    const allHazards = new Set(evalResult.hazardsDetected);
    selectedHazards.forEach((h) => allHazards.add(h));
    const finalHazardStr = allHazards.size > 0 ? Array.from(allHazards).join(' / ') : 'None';

    const sosData: TriageSOSData = {
      id: crypto.randomUUID(),
      sender: senderId,
      priority: evalResult.priority,
      medicalNeed: evalResult.medicalNeed || 'Field Incident Report',
      hazard: finalHazardStr,
      timestamp: Date.now(),
      status: 'PENDING',
      triageMethod: evalResult.triageMethod,
    };

    onSubmit(sosData);

    // Reset buffer
    setText('');
    setSelectedHazards(new Set());
    setManualPriority(Priority.LOW);
  }, [isSending, text, manualPriority, selectedHazards, nodeRole, senderId, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const effectivePriority = preview.priority;

  return (
    <div className="flex-col" style={{ width: '100%', background: 'var(--bg-void)' }}>
      {/* Top Bar: Emergency Macros */}
      <QuickMacros onSelect={(macroText) => setText(macroText)} disabled={isSending} />

      {/* Main Triage Control Center */}
      <div className="flex-col gap-2" style={{ padding: '8px 12px' }}>
        {/* Tier 1: High-Contrast Priority Selection Buttons */}
        <div className="flex-row gap-2 items-center justify-between" style={{ flexWrap: 'wrap' }}>
          <div className="flex-row gap-2 items-center">
            <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>
              TRIAGE TIER:
            </span>

            {/* CRITICAL BUTTON */}
            <button
              type="button"
              onClick={() => setManualPriority(Priority.CRITICAL)}
              className="btn text-sys"
              style={{
                fontSize: 10,
                padding: '4px 10px',
                background:
                  effectivePriority === Priority.CRITICAL ? 'var(--accent-crit)' : 'transparent',
                color:
                  effectivePriority === Priority.CRITICAL ? '#000' : 'var(--accent-crit)',
                border: '1px solid var(--accent-crit)',
                fontWeight: effectivePriority === Priority.CRITICAL ? 'bold' : 'normal',
                cursor: 'pointer',
              }}
            >
              🔴 CRITICAL (IMMEDIATE)
            </button>

            {/* URGENT BUTTON */}
            <button
              type="button"
              onClick={() => setManualPriority(Priority.HIGH)}
              className="btn text-sys"
              style={{
                fontSize: 10,
                padding: '4px 10px',
                background:
                  effectivePriority === Priority.HIGH ? 'var(--accent-warn)' : 'transparent',
                color: effectivePriority === Priority.HIGH ? '#000' : 'var(--accent-warn)',
                border: '1px solid var(--accent-warn)',
                fontWeight: effectivePriority === Priority.HIGH ? 'bold' : 'normal',
                cursor: 'pointer',
              }}
            >
              🟡 URGENT (DELAYED)
            </button>

            {/* STABLE BUTTON */}
            <button
              type="button"
              onClick={() => setManualPriority(Priority.LOW)}
              className="btn text-sys"
              style={{
                fontSize: 10,
                padding: '4px 10px',
                background:
                  effectivePriority === Priority.LOW ? 'var(--accent-radar)' : 'transparent',
                color: effectivePriority === Priority.LOW ? '#000' : 'var(--accent-radar)',
                border: '1px solid var(--accent-radar)',
                fontWeight: effectivePriority === Priority.LOW ? 'bold' : 'normal',
                cursor: 'pointer',
              }}
            >
              🟢 STABLE (MINOR)
            </button>
          </div>

          {/* Monotonic Escalation Invariant Badge */}
          {preview.isElevated && (
            <div
              className="flex-row items-center gap-1 anim-blink"
              style={{
                background: 'rgba(255, 59, 48, 0.15)',
                border: '1px solid var(--accent-crit)',
                padding: '2px 8px',
              }}
            >
              <span className="text-sys" style={{ fontSize: 9, color: 'var(--accent-crit)' }}>
                ⚠️ [AUTO-ELEVATED TO {preview.priority === Priority.CRITICAL ? 'CRITICAL' : 'URGENT'}: KEYWORD LIFE THREAT]
              </span>
            </div>
          )}

          {/* Engine Latency Indicator */}
          <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)' }}>
            ENGINE: &lt;{preview.executionTimeMs}ms // START-SALT
          </span>
        </div>

        {/* Tier 2: One-Tap Quick Hazard Toggles */}
        <div className="flex-row gap-1 items-center" style={{ flexWrap: 'wrap' }}>
          <span className="text-sys" style={{ fontSize: 9, color: 'var(--brutal-light-grey)', paddingRight: 4 }}>
            HAZARDS:
          </span>
          {HAZARD_BUTTONS.map((hazard) => {
            const isSelected = selectedHazards.has(hazard.id) || preview.hazardsDetected.includes(hazard.id);
            return (
              <button
                key={hazard.id}
                type="button"
                onClick={() => toggleHazard(hazard.id)}
                className="text-sys"
                style={{
                  fontSize: 9,
                  padding: '2px 8px',
                  background: isSelected ? hazard.color : 'transparent',
                  color: isSelected ? '#000' : hazard.color,
                  border: `1px solid ${hazard.color}`,
                  cursor: 'pointer',
                  transition: 'all 0.1s ease',
                }}
              >
                {hazard.icon} {hazard.label}
              </button>
            );
          })}
        </div>

        {/* Tier 3: Text Input Buffer with Submit Action */}
        <div className="flex-row gap-2" style={{ height: '52px' }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isSending}
            placeholder="ADD CASUALTY DETAILS, VITALS, OR NOTES... (ENTER TO TX // REAL-TIME START/SALT DETECTOR)"
            className="input-area text-sys"
            style={{
              flex: 1,
              height: '100%',
              fontSize: 11,
              padding: '6px 8px',
              border: `1px solid ${
                effectivePriority === Priority.CRITICAL
                  ? 'var(--accent-crit)'
                  : effectivePriority === Priority.HIGH
                  ? 'var(--accent-warn)'
                  : 'var(--brutal-light-grey)'
              }`,
              background: 'var(--bg-void)',
              color: 'var(--brutal-white)',
              resize: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSending}
            className="btn"
            style={{
              width: '130px',
              height: '100%',
              background:
                effectivePriority === Priority.CRITICAL
                  ? 'var(--accent-crit)'
                  : effectivePriority === Priority.HIGH
                  ? 'var(--accent-warn)'
                  : 'var(--accent-radar)',
              color: '#000',
              fontWeight: 'bold',
              border: 'none',
              cursor: isSending ? 'not-allowed' : 'pointer',
            }}
          >
            {isSending ? '[BROADCASTING...]' : `[BROADCAST ${effectivePriority === Priority.CRITICAL ? 'SOS' : 'TX'}]`}
          </button>
        </div>
      </div>
    </div>
  );
});
