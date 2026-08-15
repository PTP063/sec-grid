import { CreateMLCEngine, MLCEngine, prebuiltAppConfig } from '@mlc-ai/web-llm';
import { Priority, type TriageSOSData } from '../network/serialization/Serializer';

/** The specific model we want to run on-device. */
const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC';

/** Progress callback shape exposed to callers. */
export interface LoadProgress {
  progress: number; // 0–100
  text: string;
}

/**
 * Few-shot system prompt that anchors the LLM to output ONLY a JSON blob
 * with the exact fields we need. Using explicit examples dramatically
 * reduces hallucinations and extraneous conversational wrapping.
 */
const SYSTEM_PROMPT = `You are a medical triage AI for an offline emergency mesh network.
Your ONLY job is to parse a freeform distress message and output a single, raw JSON object.
Output NOTHING else — no markdown, no explanation, no code fences.

The JSON must have exactly these fields:
{
  "priority": "LOW" | "HIGH" | "CRITICAL",
  "medicalNeed": "<brief description of medical requirement>",
  "hazard": "<brief description of environmental hazard, or 'None'>",
  "timestamp": <current unix ms as integer>
}

Rules:
- priority is CRITICAL if life-threatening. HIGH if urgent. LOW otherwise.
- medicalNeed and hazard must each be under 120 characters.
- timestamp is always the current system time in milliseconds.

EXAMPLE INPUT: "Collapsed building, person trapped with broken leg and bleeding"
EXAMPLE OUTPUT: {"priority":"CRITICAL","medicalNeed":"Traumatic bleeding and fracture – immediate stabilization required","hazard":"Structural collapse – risk of further debris","timestamp":1723456789000}

EXAMPLE INPUT: "Mild headache, feeling dizzy, need water"
EXAMPLE OUTPUT: {"priority":"LOW","medicalNeed":"Dizziness and mild headache – possible dehydration","hazard":"None","timestamp":1723456789000}`;

/**
 * Isolates a raw JSON object from any LLM response that may contain
 * markdown code fences, trailing text, or conversational preamble.
 *
 * @param raw The raw string output from the LLM.
 * @returns The extracted JSON string, or null if not found.
 */
function extractJsonFromResponse(raw: string): string | null {
  // 1. Strip markdown fences: ```json … ``` or ``` … ```
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Locate the outermost { … } block in case of conversational wrapping
  const braceStart = raw.indexOf('{');
  const braceEnd = raw.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return raw.slice(braceStart, braceEnd + 1).trim();
  }

  return null;
}

/**
 * Maps a raw string priority value from the LLM to our typed Priority enum.
 */
function parsePriority(raw: string | undefined): Priority {
  switch ((raw ?? '').toUpperCase()) {
    case 'CRITICAL': return Priority.CRITICAL;
    case 'HIGH':     return Priority.HIGH;
    default:         return Priority.LOW;
  }
}

/**
 * Singleton manager for the on-device WebLLM engine.
 * Ensures the large model binary is loaded exactly once per browser session
 * regardless of React re-renders or component remounts.
 */
export class AIProcessor {
  private static instance: AIProcessor | null = null;
  private engine: MLCEngine | null = null;
  private initPromise: Promise<void> | null = null;

  // ─── Singleton Access ────────────────────────────────────────────────────────

  /** Returns the shared AIProcessor instance, creating it on first call. */
  public static getInstance(): AIProcessor {
    if (!AIProcessor.instance) {
      AIProcessor.instance = new AIProcessor();
    }
    return AIProcessor.instance;
  }

  // Prevent direct instantiation outside the class.
  private constructor() {}

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Loads the Phi-3.5-mini model using WebGPU.
   * Idempotent: calling this multiple times safely reuses the existing load.
   *
   * @param progressCallback Receives live progress updates (0–100 + status text).
   * @throws If WebGPU is unavailable or model loading fails.
   */
  public async initialize(progressCallback: (progress: LoadProgress) => void): Promise<void> {
    // Guard: if already loaded, signal 100% immediately and return.
    if (this.engine) {
      progressCallback({ progress: 100, text: 'Model already loaded.' });
      return;
    }

    // Guard: if a load is already in flight, attach to that same promise.
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize(progressCallback);
    return this.initPromise;
  }

  /**
   * Sends a freeform distress message through the on-device LLM and
   * parses the structured triage data from the response.
   *
   * @param userMessage The raw natural-language SOS message.
   * @returns A fully-typed TriageSOSData object.
   */
  public async extractTriageData(userMessage: string): Promise<TriageSOSData> {
    if (!this.engine) {
      throw new Error('AIProcessor not initialized. Call initialize() first.');
    }

    const fallback: TriageSOSData = {
      id: crypto.randomUUID(),
      sender: 'ai-processor',
      priority: Priority.LOW,
      medicalNeed: userMessage.slice(0, 120),
      hazard: 'None',
      timestamp: Date.now(),
    };

    try {
      const completion = await this.engine.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.1,   // Low temp for deterministic, structured output
        max_tokens: 256,
        stream: false,
      });

      const rawText = completion.choices[0]?.message?.content ?? '';
      const jsonStr = extractJsonFromResponse(rawText);

      if (!jsonStr) {
        console.warn('[AIProcessor] Could not extract JSON from LLM response. Using fallback.', rawText);
        return fallback;
      }

      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

      return {
        id: crypto.randomUUID(),
        sender: 'ai-processor',
        priority: parsePriority(parsed.priority as string),
        medicalNeed: String(parsed.medicalNeed ?? fallback.medicalNeed).slice(0, 120),
        hazard:      String(parsed.hazard      ?? 'None').slice(0, 120),
        timestamp:   typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      };
    } catch (error) {
      console.error('[AIProcessor] Inference or parse error. Using fallback.', error);
      return fallback;
    }
  }

  /**
   * Whether the engine has been successfully loaded and is ready.
   */
  public get isReady(): boolean {
    return this.engine !== null;
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private async _doInitialize(progressCallback: (progress: LoadProgress) => void): Promise<void> {
    // Check for WebGPU availability before attempting to load.
    if (!(navigator as any).gpu) {
      throw new Error(
        'WebGPU is not supported in this browser or on this hardware. ' +
        'Please use Chrome 113+ on a device with GPU acceleration enabled.'
      );
    }

    try {
      // Rewrite HuggingFace URLs to a mirror for users without a VPN
      const customAppConfig = { ...prebuiltAppConfig };
      customAppConfig.model_list = customAppConfig.model_list.map((m) => {
        if (m.model_id === MODEL_ID) {
          return {
            ...m,
            model: m.model.replace('https://huggingface.co/', self.location.origin + '/hf-proxy-v2/'),
          };
        }
        return m;
      });
      this.engine = await CreateMLCEngine(
        MODEL_ID,
        {
          initProgressCallback: (report) => {
            // report.progress is 0.0–1.0; normalise to 0–100 for UI convenience.
            progressCallback({
              progress: Math.round((report.progress ?? 0) * 100),
              text: report.text ?? 'Loading model…',
            });
          },
          appConfig: customAppConfig
        }
      );

      // Signal completion
      progressCallback({ progress: 100, text: 'Model loaded and ready.' });
    } catch (error) {
      // Reset so callers can retry
      this.initPromise = null;
      this.engine = null;
      throw error;
    }
  }
}
