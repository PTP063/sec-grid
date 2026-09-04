import { create } from 'zustand';
import type { TriageSOSData, TriageStatus } from '../network/serialization/Serializer';
import { appendLog, reconstituteFromWAL } from '../storage/WAL';

export type TriageFilter = 'ALL' | 'CRITICAL' | 'HAZARD' | 'UNPROCESSED' | 'ACKNOWLEDGED' | 'RESOLVED';

interface MessageState {
  messages: TriageSOSData[];
  compressionMetric: string;
  isSending: boolean;
  audioEnabled: boolean;
  activeFilter: TriageFilter;
  searchQuery: string;
  selectedMessageId: string | null;
  
  initWAL: () => Promise<void>;
  addOrUpdateMessage: (msg: TriageSOSData) => void;
  updateMessageStatus: (id: string, status: TriageStatus) => TriageSOSData | null;
  setCompressionMetric: (metric: string) => void;
  setIsSending: (sending: boolean) => void;
  toggleAudio: () => void;
  setActiveFilter: (filter: TriageFilter) => void;
  setSearchQuery: (query: string) => void;
  setSelectedMessageId: (id: string | null) => void;
}

const getInitialAudio = (): boolean => {
  if (typeof window === 'undefined') return true;
  const saved = localStorage.getItem('mesh_audio_enabled');
  return saved !== null ? saved === 'true' : true;
};

export const useMessageStore = create<MessageState>((set, get) => ({
  messages: [],
  compressionMetric: '',
  isSending: false,
  audioEnabled: getInitialAudio(),
  activeFilter: 'ALL',
  searchQuery: '',
  selectedMessageId: null,

  initWAL: async () => {
    try {
      const logs = await reconstituteFromWAL();
      set({ messages: logs });
    } catch (err) {
      console.error('[WAL] Failed to load history:', err);
    }
  },

  addOrUpdateMessage: (msg) => {
    const normalized: TriageSOSData = {
      ...msg,
      status: msg.status || 'PENDING',
    };

    set((state) => {
      const existing = state.messages.find(m => m.id === normalized.id);
      
      // Preserve AI processed state if an older unprocessed packet bounces in
      if (existing && existing.hazard !== 'UNPROCESSED' && normalized.hazard === 'UNPROCESSED') {
        normalized.hazard = existing.hazard;
        normalized.priority = existing.priority;
        normalized.medicalNeed = existing.medicalNeed;
      }

      // Preserve status if existing has progressed further and incoming is still PENDING
      if (existing && existing.status && existing.status !== 'PENDING' && normalized.status === 'PENDING') {
        normalized.status = existing.status;
      }

      appendLog(normalized).catch(err => console.error('[WAL] Save failed:', err));

      return {
        messages: [...state.messages.filter(m => m.id !== normalized.id), normalized],
      };
    });
  },

  updateMessageStatus: (id, status) => {
    const state = get();
    const target = state.messages.find(m => m.id === id);
    if (!target) return null;

    const updated: TriageSOSData = {
      ...target,
      status,
    };

    appendLog(updated).catch(err => console.error('[WAL] Save status failed:', err));

    set({
      messages: state.messages.map(m => (m.id === id ? updated : m)),
    });

    return updated;
  },
    
  setCompressionMetric: (metric) => set({ compressionMetric: metric }),
  setIsSending: (sending) => set({ isSending: sending }),
  
  toggleAudio: () => set((state) => {
    const next = !state.audioEnabled;
    if (typeof window !== 'undefined') {
      localStorage.setItem('mesh_audio_enabled', String(next));
    }
    return { audioEnabled: next };
  }),

  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedMessageId: (id) => set({ selectedMessageId: id }),
}));
