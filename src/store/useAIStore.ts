import { create } from 'zustand';
import type { TriageSOSData } from '../network/Serializer';
import { evaluateEmergencyTriage } from '../triage/DeterministicTriage';

interface AIState {
  isLoaded: boolean;
  isMockMode: boolean;
  isHeuristicLocked: boolean;
  loadingProgress: number;
  loadingText: string;
  error: string | null;
  isLoading: boolean;

  loadModel: () => Promise<void>;
  processMessage: (text: string) => Promise<TriageSOSData | null>;
}

/**
 * Backwards-compatible facade over the deterministic triage engine.
 * Eliminates all WebGPU, Worker, and neural download overhead.
 */
export const useAIStore = create<AIState>(() => ({
  isLoaded: true,
  isMockMode: false,
  isHeuristicLocked: true,
  loadingProgress: 100,
  loadingText: 'Deterministic START/SALT Active (<0.2ms)',
  error: null,
  isLoading: false,

  loadModel: async () => {
    // Immediate no-op: deterministic engine is always loaded and ready
  },

  processMessage: async (text: string) => {
    if (!text.trim()) return null;
    const res = evaluateEmergencyTriage(text);
    return {
      id: crypto.randomUUID(),
      sender: 'deterministic-triage',
      priority: res.priority,
      medicalNeed: res.medicalNeed,
      hazard: res.hazard,
      timestamp: Date.now(),
      status: 'PENDING',
      triageMethod: res.triageMethod,
    };
  },
}));
