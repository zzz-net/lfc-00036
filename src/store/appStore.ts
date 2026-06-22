import { create } from 'zustand';
import { api } from '@/lib/api';
import type { AnomalyFilters } from '@shared/types';

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface AppState {
  toasts: ToastItem[];
  anomalyFilters: AnomalyFilters;
  addToast: (type: ToastItem['type'], message: string) => void;
  removeToast: (id: number) => void;
  setAnomalyFilters: (filters: AnomalyFilters) => void;
  loadPersistedState: () => Promise<void>;
  savePersistedState: () => Promise<void>;
}

let toastId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  toasts: [],
  anomalyFilters: {
    page: 1,
    page_size: 20,
  },

  addToast: (type, message) => {
    const id = ++toastId;
    set(s => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => {
    set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }));
  },

  setAnomalyFilters: (filters) => {
    set({ anomalyFilters: filters });
    get().savePersistedState();
  },

  loadPersistedState: async () => {
    try {
      const res = await api.statistics.getState<AnomalyFilters>('anomalyFilters');
      if (res.value) {
        set({ anomalyFilters: { page: 1, page_size: 20, ...res.value } });
      }
    } catch {
      // ignore
    }
  },

  savePersistedState: async () => {
    try {
      await api.statistics.saveState('anomalyFilters', get().anomalyFilters);
    } catch {
      // ignore
    }
  },
}));
