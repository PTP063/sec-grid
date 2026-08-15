/// <reference lib="webworker" />
import { AIProcessor } from './WebLLMService';
import type { TriageSOSData } from '../network/serialization/Serializer';

export type WorkerMessageOut =
  | { type: 'PROGRESS'; payload: { progress: number; text: string } }
  | { type: 'INIT_DONE' }
  | { type: 'INIT_ERROR'; payload: string }
  | { type: 'INFER_RESULT'; payload: { id: string; result: TriageSOSData | null } };

export type WorkerMessageIn =
  | { type: 'INIT' }
  | { type: 'INFER'; payload: { id: string; text: string } };

const processor = AIProcessor.getInstance();

self.onmessage = async (e: MessageEvent<WorkerMessageIn>) => {
  const { data } = e;

  if (data.type === 'INIT') {
    try {
      await processor.initialize((progress) => {
        self.postMessage({ type: 'PROGRESS', payload: progress } satisfies WorkerMessageOut);
      });
      self.postMessage({ type: 'INIT_DONE' } satisfies WorkerMessageOut);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'INIT_ERROR', payload: message } satisfies WorkerMessageOut);
    }
  } else if (data.type === 'INFER') {
    const { id, text } = data.payload;
    try {
      const result = await processor.extractTriageData(text);
      self.postMessage({ type: 'INFER_RESULT', payload: { id, result } } satisfies WorkerMessageOut);
    } catch (err) {
      console.error('[ai.worker] Inference error:', err);
      self.postMessage({ type: 'INFER_RESULT', payload: { id, result: null } } satisfies WorkerMessageOut);
    }
  }
};
