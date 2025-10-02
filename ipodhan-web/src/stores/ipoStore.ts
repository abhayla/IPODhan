import { create } from 'zustand';
import type { IPO, IPOScore, SearchFilters } from '@/types/ipo';
import {
  getIPOs,
  getIPOById,
  getIPOScore,
  type GetIPOsParams,
} from '@/lib/api/ipo.service';

export interface IPOState {
  // Data
  ipos: IPO[];
  scores: Record<string, IPOScore>;
  currentIPO: IPO | null;
  currentScore: IPOScore | null;

  // UI State
  loading: boolean;
  error: string | null;

  // Filters
  filter: SearchFilters;
  searchQuery: string;

  // Pagination
  page: number;
  limit: number;
  total: number;

  // Actions
  fetchIPOs: (params?: GetIPOsParams) => Promise<void>;
  fetchIPOById: (id: string) => Promise<void>;
  fetchIPOScore: (id: string) => Promise<void>;
  setFilter: (filter: Partial<SearchFilters>) => void;
  setSearchQuery: (query: string) => void;
  setPage: (page: number) => void;
  clearError: () => void;
  reset: () => void;

  // WebSocket placeholder
  subscribeToUpdates: (ipoId: string) => void;
  unsubscribeFromUpdates: (ipoId: string) => void;
}

const initialState = {
  ipos: [],
  scores: {},
  currentIPO: null,
  currentScore: null,
  loading: false,
  error: null,
  filter: {},
  searchQuery: '',
  page: 1,
  limit: 12,
  total: 0,
};

export const useIPOStore = create<IPOState>((set, get) => ({
  ...initialState,

  fetchIPOs: async (params = {}) => {
    set({ loading: true, error: null });
    try {
      const { filter, page, limit } = get();

      // Merge params with current filter state
      const queryParams: GetIPOsParams = {
        status: filter.status || params.status,
        category: filter.category || params.category,
        page: params.page || page,
        limit: params.limit || limit,
      };

      const response = await getIPOs(queryParams);

      set({
        ipos: response.data,
        total: response.total,
        page: response.page,
        loading: false,
      });
    } catch (error: any) {
      set({
        error: error.message || 'Failed to fetch IPOs',
        loading: false,
      });
    }
  },

  fetchIPOById: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const ipo = await getIPOById(id);
      set({
        currentIPO: ipo,
        loading: false,
      });
    } catch (error: any) {
      set({
        error: error.message || 'Failed to fetch IPO details',
        loading: false,
      });
    }
  },

  fetchIPOScore: async (id: string) => {
    try {
      const score = await getIPOScore(id);
      set(state => ({
        scores: {
          ...state.scores,
          [id]: score,
        },
        currentScore: score,
      }));
    } catch (error: any) {
      console.error('Failed to fetch IPO score:', error);
    }
  },

  setFilter: filter => {
    set(state => ({
      filter: {
        ...state.filter,
        ...filter,
      },
      page: 1, // Reset to page 1 when filter changes
    }));

    // Auto-fetch with new filters
    get().fetchIPOs();
  },

  setSearchQuery: query => {
    set({ searchQuery: query });
  },

  setPage: page => {
    set({ page });
    get().fetchIPOs();
  },

  clearError: () => {
    set({ error: null });
  },

  reset: () => {
    set(initialState);
  },

  // WebSocket placeholder - to be implemented later
  subscribeToUpdates: ipoId => {
    console.log('Subscribing to updates for IPO:', ipoId);
    // TODO: Implement WebSocket subscription
  },

  unsubscribeFromUpdates: ipoId => {
    console.log('Unsubscribing from updates for IPO:', ipoId);
    // TODO: Implement WebSocket unsubscription
  },
}));
