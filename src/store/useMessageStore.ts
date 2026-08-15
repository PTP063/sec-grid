import { create } from 'zustand';
import type { TriageSOSData } from '../network/serialization/Serializer';
import { saveMessageToWAL, loadAllMessagesFromWAL } from './WAL';

interface MessageState {
  messages: TriageSOSData[];
  compressionMetric: string;
  isSending: boolean;
  
  initWAL: () => Promise<void>;
  addOrUpdateMessage: (msg: TriageSOSData) => void;
  setCompressionMetric: (metric: string) => void;
  setIsSending: (sending: boolean) => void;
}

export const useMessageStore = create<MessageState>((set) => ({
  messages: [],
  compressionMetric: '',
  isSending: false,

  initWAL: async () => {
    try {
      const logs = await loadAllMessagesFromWAL();
      set({ messages: logs.sort((a, b) => a.timestamp - b.timestamp) });
    } catch (err) {
      console.error('[WAL] Failed to load history:', err);
    }
  },

  addOrUpdateMessage: (msg) => {
    saveMessageToWAL(msg).catch(err => console.error('[WAL] Save failed:', err));
    set((state) => {
      const existing = state.messages.find(m => m.id === msg.id);
      if (existing && existing.hazard !== 'UNPROCESSED' && msg.hazard === 'UNPROCESSED') {
        return state;
      }
      return {
        messages: [...state.messages.filter(m => m.id !== msg.id), msg]
      };
    });
  },
    
  setCompressionMetric: (metric) => set({ compressionMetric: metric }),
  setIsSending: (sending) => set({ isSending: sending }),
}));
