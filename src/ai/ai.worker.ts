/// <reference lib="webworker" />
import { AIProcessor } from './WebLLMService';
import type { TriageSOSData } from '../network/serialization/Serializer';
import { parseTriageHeuristics } from './triageHeuristics';

export { parseTriageHeuristics };

export type WorkerMessageOut =
  | { type: 'PROGRESS'; payload: { progress: number; text: string } }
  | { type: 'INIT_DONE'; payload?: { mode: 'HEURISTIC' | 'LLM' } }
  | { type: 'INIT_ERROR'; payload: string }
  | { type: 'INFER_RESULT'; payload: { id: string; result: TriageSOSData | null } };

export type WorkerMessageIn =
  | { type: 'INIT'; payload?: { lockHeuristic?: boolean } }
  | { type: 'INFER'; payload: { id: string; text: string } };

let isHeuristicMode = false;
let processor: AIProcessor | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessageIn>) => {
  const { data } = e;

  if (data.type === 'INIT') {
    if (data.payload?.lockHeuristic) {
      isHeuristicMode = true;
      console.log('[ai.worker] Mobile Battery-Saver Policy: Locked to Tier 1 Regex Heuristic.');
      self.postMessage({ type: 'INIT_DONE', payload: { mode: 'HEURISTIC' } } satisfies WorkerMessageOut);
      return;
    }

    try {
      processor = AIProcessor.getInstance();
      await processor.initialize((progress) => {
        self.postMessage({ type: 'PROGRESS', payload: progress } satisfies WorkerMessageOut);
      });
      self.postMessage({ type: 'INIT_DONE', payload: { mode: 'LLM' } } satisfies WorkerMessageOut);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ai.worker] WebGPU/LLM initialization failed. Falling back to Tier 1 Heuristic:', message);
      isHeuristicMode = true;
      self.postMessage({ type: 'INIT_DONE', payload: { mode: 'HEURISTIC' } } satisfies WorkerMessageOut);
    }
  } else if (data.type === 'INFER') {
    const { id, text } = data.payload;

    if (isHeuristicMode || !processor?.isReady) {
      const result = parseTriageHeuristics(text);
      self.postMessage({ type: 'INFER_RESULT', payload: { id, result } } satisfies WorkerMessageOut);
      return;
    }

    try {
      const result = await processor.extractTriageData(text);
      self.postMessage({ type: 'INFER_RESULT', payload: { id, result } } satisfies WorkerMessageOut);
    } catch (err) {
      console.error('[ai.worker] LLM Inference error. Falling back to Tier 1 Heuristics:', err);
      const result = parseTriageHeuristics(text);
      self.postMessage({ type: 'INFER_RESULT', payload: { id, result } } satisfies WorkerMessageOut);
    }
  }
};
