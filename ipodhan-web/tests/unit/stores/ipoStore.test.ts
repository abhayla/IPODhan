import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useIPOStore } from '@/stores/ipoStore';

// Mock the API service
vi.mock('@/lib/api/ipo.service', () => ({
  getIPOs: vi.fn(),
  getIPOById: vi.fn(),
  getIPOScore: vi.fn(),
}));

import { getIPOs, getIPOById, getIPOScore } from '@/lib/api/ipo.service';

describe('IPO Store', () => {
  beforeEach(() => {
    // Reset store state
    useIPOStore.setState({
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
    });
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const state = useIPOStore.getState();

    expect(state.ipos).toEqual([]);
    expect(state.scores).toEqual({});
    expect(state.loading).toBe(false);
    expect(state.error).toBe(null);
    expect(state.page).toBe(1);
    expect(state.limit).toBe(12);
  });

  it('sets filter and resets page to 1', async () => {
    const mockIPOs = {
      data: [{ id: '1', companyName: 'Test IPO' }],
      total: 1,
      page: 1,
      limit: 12,
    };

    vi.mocked(getIPOs).mockResolvedValue(mockIPOs);

    const { setFilter } = useIPOStore.getState();

    // First set page to 5
    useIPOStore.setState({ page: 5 });
    expect(useIPOStore.getState().page).toBe(5);

    // Then set filter (should reset to page 1)
    await setFilter({ status: 'LIVE' });

    const state = useIPOStore.getState();
    expect(state.filter.status).toBe('LIVE');
    expect(state.page).toBe(1);
  });

  it('updates search query', () => {
    const { setSearchQuery } = useIPOStore.getState();

    setSearchQuery('test company');

    expect(useIPOStore.getState().searchQuery).toBe('test company');
  });

  it('clears error state', () => {
    useIPOStore.setState({ error: 'Test error' });
    expect(useIPOStore.getState().error).toBe('Test error');

    const { clearError } = useIPOStore.getState();
    clearError();

    expect(useIPOStore.getState().error).toBe(null);
  });

  it('resets store to initial state', () => {
    useIPOStore.setState({
      ipos: [{ id: '1', companyName: 'Test' } as any],
      loading: true,
      error: 'Error',
      page: 5,
    });

    const { reset } = useIPOStore.getState();
    reset();

    const state = useIPOStore.getState();
    expect(state.ipos).toEqual([]);
    expect(state.loading).toBe(false);
    expect(state.error).toBe(null);
    expect(state.page).toBe(1);
  });

  it('sets page and triggers fetch', async () => {
    const mockIPOs = {
      data: [],
      total: 0,
      page: 3,
      limit: 12,
    };

    vi.mocked(getIPOs).mockResolvedValue(mockIPOs);

    const { setPage } = useIPOStore.getState();
    await setPage(3);

    expect(useIPOStore.getState().page).toBe(3);
    expect(getIPOs).toHaveBeenCalled();
  });
});
