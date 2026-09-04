import { create } from 'zustand';
import {
  evaluateEmergencyTriage,
  type TriageResult,
  type EvaluateOptions,
  Priority,
} from '../triage/DeterministicTriage';
import type { TriageSOSData } from '../network/Serializer';

interface TriageStoreState {
  isReady: boolean;
  totalTriaged: number;
  lastExecutionTimeMs: number;
  lastTriageResult: TriageResult | null;

  // Real-time debounced preview state for HUD
  previewPriority: Priority;
  previewHazards: string[];
  isElevated: boolean;
  elevationReason?: string;

  updatePreview: (text: string, manualPriority?: Priority, manualHazard?: string) => void;
  triageText: (text: string, senderId: string, options?: EvaluateOptions) => TriageSOSData;
}

export const useTriageStore = create<TriageStoreState>((set) => ({
  isReady: true,
  totalTriaged: 0,
  lastExecutionTimeMs: 0.1,
  lastTriageResult: null,

  previewPriority: Priority.LOW,
  previewHazards: [],
  isElevated: false,
  elevationReason: undefined,

  updatePreview: (text, manualPriority, manualHazard) => {
    const res = evaluateEmergencyTriage(text, {
      manualPriority,
      manualHazard: (manualHazard as any) || undefined,
    });

    set({
      previewPriority: res.priority,
      previewHazards: res.hazardsDetected,
      isElevated: res.isElevated,
      elevationReason: res.elevationReason,
      lastExecutionTimeMs: res.executionTimeMs,
    });
  },

  triageText: (text, senderId, options) => {
    const res = evaluateEmergencyTriage(text, options);

    set((s) => ({
      totalTriaged: s.totalTriaged + 1,
      lastExecutionTimeMs: res.executionTimeMs,
      lastTriageResult: res,
    }));

    return {
      id: crypto.randomUUID(),
      sender: senderId,
      priority: res.priority,
      medicalNeed: res.medicalNeed,
      hazard: res.hazard,
      timestamp: Date.now(),
      status: 'PENDING',
      triageMethod: res.triageMethod,
    };
  },
}));
