import { create } from 'zustand';

export interface AppError {
  id: string;
  message: string;
  stack?: string;
  timestamp: number;
}

interface ErrorState {
  errors: AppError[];
  addError: (error: Error | string) => void;
  dismissError: (id: string) => void;
  clearAll: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  errors: [],
  addError: (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    
    set((state) => ({
      errors: [
        ...state.errors,
        {
          id: crypto.randomUUID(),
          message,
          stack,
          timestamp: Date.now(),
        },
      ],
    }));
  },
  dismissError: (id) =>
    set((state) => ({
      errors: state.errors.filter((e) => e.id !== id),
    })),
  clearAll: () => set({ errors: [] }),
}));
