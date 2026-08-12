import { useState, useCallback, useRef } from 'react';
import { AIProcessor } from './WebLLMService';
import { Priority, type TriageSOSData } from '../network/serialization/Serializer';

/** Shape of the state returned by the hook. */
export interface UseAIReturn {
  /** True once the model has been loaded and is ready for inference. */
  isLoaded: boolean;
  /** True if we failed to fetch the real model and fell back to mock mode. */
  isMockMode: boolean;
  /** Loading progress as an integer 0–100. */
  loadingProgress: number;
  /** Human-readable status text from the model loader. */
  loadingText: string;
  /** Non-null when a WebGPU or model loading error has occurred. */
  error: string | null;
  /** Triggers model initialization; safe to call multiple times. */
  loadModel: () => Promise<void>;
  /** Runs inference on a raw SOS message and returns structured triage data. */
  processMessage: (text: string) => Promise<TriageSOSData | null>;
}

/**
 * React hook that manages the lifecycle of the on-device AI triage engine.
 *
 * Design decisions:
 * - Uses `useRef` to hold the processor reference so it is **never** affected
 *   by re-renders and the singleton is not re-created on state updates.
 * - `loadModel` is idempotent: calling it while already loading or after
 *   successful load is a no-op (guarded both here and in `AIProcessor`).
 * - WebGPU errors are caught here and surfaced via the `error` state instead
 *   of propagating as unhandled crashes.
 */
export function useAI(): UseAIReturn {
  const [isLoaded, setIsLoaded]               = useState<boolean>(false);
  const [isMockMode, setIsMockMode]           = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [loadingText, setLoadingText]         = useState<string>('');
  const [error, setError]                     = useState<string | null>(null);

  // Stable ref to the singleton — survives any number of re-renders.
  const processorRef = useRef<AIProcessor>(AIProcessor.getInstance());

  // Prevent concurrent `loadModel` calls from racing each other.
  const isLoadingRef = useRef<boolean>(false);

  /**
   * Initializes the WebLLM engine.
   * Subsequent calls while loading is in progress are silently ignored.
   */
  const loadModel = useCallback(async (): Promise<void> => {
    if (isLoaded || isLoadingRef.current) return;

    isLoadingRef.current = true;
    setError(null);
    setLoadingProgress(0);
    setLoadingText('Starting model download…');

    try {
      await processorRef.current.initialize(({ progress, text }) => {
        setLoadingProgress(progress);
        setLoadingText(text);
      });
      setIsLoaded(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      
      // Auto-fallback to mock mode if HuggingFace is blocked
      if (message.toLowerCase().includes('failed to fetch')) {
        console.warn('[useAI] Network blocked. Falling back to Mock AI Mode.');
        setIsMockMode(true);
        setIsLoaded(true);
        setError(null);
        setLoadingProgress(100);
        setLoadingText('Offline Mock Mode');
      } else {
        setError(message);
        setLoadingProgress(0);
        setLoadingText('');
        
        // Surface WebGPU-specific errors with a more actionable message.
        if (message.toLowerCase().includes('webgpu')) {
          console.error('[useAI] WebGPU unavailable. The on-device AI triage engine cannot run.', err);
        } else {
          console.error('[useAI] Model loading failed.', err);
        }
      }
    } finally {
      isLoadingRef.current = false;
    }
  }, [isLoaded]);

  /**
   * Runs a freeform distress message through the on-device LLM and returns
   * structured TriageSOSData.  Returns null if the model is not yet loaded
   * or an inference error occurs.
   */
  const processMessage = useCallback(
    async (text: string): Promise<TriageSOSData | null> => {
      if (!isLoaded) {
        console.warn('[useAI] processMessage called before model is loaded.');
        return null;
      }
      if (!text.trim()) {
        console.warn('[useAI] processMessage called with empty text.');
        return null;
      }

      // Mock Mode Inference
      if (isMockMode) {
        // Simulate LLM processing latency
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

      try {
        return await processorRef.current.extractTriageData(text);
      } catch (err) {
        console.error('[useAI] Inference error during processMessage.', err);
        return null;
      }
    },
    [isLoaded, isMockMode]
  );

  return {
    isLoaded,
    isMockMode,
    loadingProgress,
    loadingText,
    error,
    loadModel,
    processMessage,
  };
}
