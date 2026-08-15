import { create } from 'zustand';
import { Priority, type TriageSOSData } from '../network/serialization/Serializer';
import type { WorkerMessageIn, WorkerMessageOut } from '../ai/ai.worker';

interface AIState {
  isLoaded: boolean;
  isMockMode: boolean;
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
  
  // Set up worker message listener
  aiWorker.onmessage = (e: MessageEvent<WorkerMessageOut>) => {
    const data = e.data;
    switch (data.type) {
      case 'PROGRESS':
        set({ loadingProgress: data.payload.progress, loadingText: data.payload.text });
        break;
      case 'INIT_DONE':
        set({ isLoaded: true, isLoading: false, loadingProgress: 100, loadingText: 'Model loaded and ready.' });
        break;
      case 'INIT_ERROR':
        const message = data.payload.toLowerCase();
        if (message.includes('failed to fetch')) {
          console.warn('[useAIStore] Network blocked. Falling back to Mock AI Mode.');
          set({
            isMockMode: true,
            isLoaded: true,
            isLoading: false,
            error: null,
            loadingProgress: 100,
            loadingText: 'Offline Mock Mode',
          });
        } else {
          set({ error: data.payload, loadingProgress: 0, loadingText: '', isLoading: false });
        }
        break;
      case 'INFER_RESULT':
        const { id, result } = data.payload;
        const resolve = pendingInferences.get(id);
        if (resolve) {
          resolve(result);
          pendingInferences.delete(id);
        }
        break;
    }
  };

  return {
    isLoaded: false,
    isMockMode: false,
    loadingProgress: 0,
    loadingText: '',
    error: null,
    isLoading: false,

    loadModel: async () => {
      if (get().isLoaded || get().isLoading) return;

      set({
        isLoading: true,
        error: null,
        loadingProgress: 0,
        loadingText: 'Starting model download…',
      });

      aiWorker.postMessage({ type: 'INIT' } satisfies WorkerMessageIn);
    },

    processMessage: async (text) => {
      const { isLoaded, isMockMode } = get();
      if (!isLoaded || !text.trim()) return null;

      if (isMockMode) {
        await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200));
        let priority: Priority = Priority.LOW;
        const lower = text.toLowerCase();
        if (lower.includes('heart') || lower.includes('bleed') || lower.includes('crit')) priority = Priority.CRITICAL;
        else if (lower.includes('broken') || lower.includes('burn')) priority = Priority.HIGH;

        return {
          id: crypto.randomUUID(),
          sender: 'mock-ai',
          priority: priority,
          medicalNeed: text.slice(0, 50) + (text.length > 50 ? '...' : ''),
          hazard: lower.includes('fire') ? 'Fire' : 'None',
          timestamp: Date.now(),
        };
      }

      return new Promise<TriageSOSData | null>((resolve) => {
        const id = crypto.randomUUID();
        pendingInferences.set(id, resolve);
        aiWorker.postMessage({ type: 'INFER', payload: { id, text } } satisfies WorkerMessageIn);
      });
    },
  };
});
