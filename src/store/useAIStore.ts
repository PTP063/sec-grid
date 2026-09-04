import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import type { TriageSOSData } from '../network/serialization/Serializer';
import type { WorkerMessageIn, WorkerMessageOut } from '../ai/ai.worker';

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

// Global worker instance
const aiWorker = new Worker(new URL('../ai/ai.worker.ts', import.meta.url), { type: 'module' });

// Keep track of pending inferences
const pendingInferences = new Map<string, (result: TriageSOSData | null) => void>();

export const useAIStore = create<AIState>((set, get) => {
  const isNative = Capacitor.isNativePlatform();

  // Set up worker message listener
  aiWorker.onmessage = (e: MessageEvent<WorkerMessageOut>) => {
    const data = e.data;
    switch (data.type) {
      case 'PROGRESS':
        set({ loadingProgress: data.payload.progress, loadingText: data.payload.text });
        break;
      case 'INIT_DONE': {
        const isHeuristic = data.payload?.mode === 'HEURISTIC' || isNative;
        set({
          isLoaded: true,
          isLoading: false,
          isHeuristicLocked: isHeuristic,
          loadingProgress: 100,
          loadingText: isHeuristic ? 'Battery-Saver Heuristic Active' : 'Model loaded and ready.',
        });
        break;
      }
      case 'INIT_ERROR': {
        console.warn('[useAIStore] WebGPU error, falling back to Tier 1 Heuristic:', data.payload);
        set({
          isLoaded: true,
          isLoading: false,
          isHeuristicLocked: true,
          error: null,
          loadingProgress: 100,
          loadingText: 'Battery-Saver Heuristic Active',
        });
        break;
      }
      case 'INFER_RESULT': {
        const { id, result } = data.payload;
        const resolve = pendingInferences.get(id);
        if (resolve) {
          resolve(result);
          pendingInferences.delete(id);
        }
        break;
      }
    }
  };

  return {
    isLoaded: false,
    isMockMode: false,
    isHeuristicLocked: isNative,
    loadingProgress: 0,
    loadingText: '',
    error: null,
    isLoading: false,

    loadModel: async () => {
      if (get().isLoaded || get().isLoading) return;

      // On native platforms, lock to zero-latency regex heuristic immediately
      if (isNative) {
        set({
          isLoading: true,
          error: null,
          loadingProgress: 50,
          loadingText: 'Locking Tier 1 Heuristic...',
        });
        aiWorker.postMessage({ type: 'INIT', payload: { lockHeuristic: true } } satisfies WorkerMessageIn);
        return;
      }

      set({
        isLoading: true,
        error: null,
        loadingProgress: 0,
        loadingText: 'Starting model download…',
      });

      aiWorker.postMessage({ type: 'INIT' } satisfies WorkerMessageIn);
    },

    processMessage: async (text) => {
      const { isLoaded } = get();
      if (!isLoaded || !text.trim()) return null;

      return new Promise<TriageSOSData | null>((resolve) => {
        const id = crypto.randomUUID();
        pendingInferences.set(id, resolve);
        aiWorker.postMessage({ type: 'INFER', payload: { id, text } } satisfies WorkerMessageIn);
      });
    },
  };
});
