# Frontend Architecture

## Component Architecture

### Component Organization
```
ipodhan-web/src/
├── components/
│   ├── common/          # Shared components
│   │   ├── ScoreDisplay/
│   │   ├── VerdictBadge/
│   │   └── LoadingStates/
│   ├── ipo/            # IPO-specific components
│   │   ├── IPOCard/
│   │   ├── IPODetails/
│   │   ├── SubscriptionMeter/
│   │   └── GMPChart/
│   ├── layout/         # Layout components
│   │   ├── Header/
│   │   ├── Footer/
│   │   └── Navigation/
│   └── features/       # Feature components
│       ├── Watchlist/
│       ├── BrokerHub/
│       └── Calculator/
├── pages/              # Next.js pages
├── hooks/              # Custom React hooks
├── services/           # API service layer
├── stores/            # Zustand stores
├── styles/            # Global styles
└── utils/             # Utility functions
```

### Component Template
```typescript
// components/ipo/IPOCard/IPOCard.tsx
import React from 'react';
import { IPO, IPOScore } from '@ipodhan/shared/types';
import { ScoreDisplay } from '@/components/common/ScoreDisplay';
import { VerdictBadge } from '@/components/common/VerdictBadge';

interface IPOCardProps {
  ipo: IPO;
  score?: IPOScore;
  variant?: 'compact' | 'standard' | 'expanded';
  onClick?: () => void;
}

export const IPOCard: React.FC<IPOCardProps> = ({
  ipo,
  score,
  variant = 'standard',
  onClick
}) => {
  return (
    <div
      className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-semibold">{ipo.companyName}</h3>
          <p className="text-sm text-gray-600">{ipo.symbol}</p>
        </div>
        {score && (
          <div className="flex items-center gap-2">
            <ScoreDisplay score={score.totalScore} size="medium" />
            <VerdictBadge verdict={score.verdict} />
          </div>
        )}
      </div>
      {/* Additional content based on variant */}
    </div>
  );
};
```

## State Management Architecture

### State Structure
```typescript
// stores/ipoStore.ts
import { create } from 'zustand';
import { IPO, IPOScore } from '@ipodhan/shared/types';

interface IPOState {
  ipos: IPO[];
  scores: Record<string, IPOScore>;
  loading: boolean;
  error: string | null;
  filter: {
    status: 'LIVE' | 'UPCOMING' | 'CLOSED' | null;
    category: 'MAINBOARD' | 'SME' | null;
  };

  // Actions
  fetchIPOs: () => Promise<void>;
  setFilter: (filter: Partial<IPOState['filter']>) => void;
  subscribeToUpdates: (ipoId: string) => void;
}

export const useIPOStore = create<IPOState>((set, get) => ({
  ipos: [],
  scores: {},
  loading: false,
  error: null,
  filter: {
    status: null,
    category: null,
  },

  fetchIPOs: async () => {
    set({ loading: true });
    try {
      const response = await ipoService.getIPOs(get().filter);
      set({ ipos: response.data, loading: false });
    } catch (error) {
      set({ error: error.message, loading: false });
    }
  },

  setFilter: (filter) => {
    set((state) => ({ filter: { ...state.filter, ...filter } }));
    get().fetchIPOs();
  },

  subscribeToUpdates: (ipoId) => {
    // WebSocket subscription logic
  },
}));
```

### State Management Patterns
- Use Zustand stores for global state
- Keep component state local when possible
- Implement optimistic updates for better UX
- Use React Query for server state caching
- Separate concerns into domain-specific stores

## Routing Architecture

### Route Organization
```
pages/
├── index.tsx                 # Homepage with live IPOs
├── ipo/
│   ├── [id].tsx             # IPO detail page
│   └── index.tsx            # IPO listing page
├── watchlist.tsx            # User watchlist
├── brokers/
│   ├── index.tsx           # Broker comparison
│   └── [broker].tsx        # Broker details
├── tools/
│   ├── roi-calculator.tsx
│   └── allotment.tsx
├── api/
│   ├── auth/[...nextauth].ts
│   └── webhooks/
│       └── whatsapp.ts
└── _app.tsx                # App wrapper
```

### Protected Route Pattern
```typescript
// components/auth/ProtectedRoute.tsx
import { useRouter } from 'next/router';
import { useAuth } from '@/hooks/useAuth';

export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login?redirect=' + router.asPath);
    }
  }, [user, loading, router]);

  if (loading) return <LoadingScreen />;
  if (!user) return null;

  return <>{children}</>;
};
```

## Frontend Services Layer

### API Client Setup
```typescript
// services/api/client.ts
import axios from 'axios';
import { getSession } from 'next-auth/react';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
});

apiClient.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Handle token refresh
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

### Service Example
```typescript
// services/api/ipoService.ts
import apiClient from './client';
import { IPO, IPOScore } from '@ipodhan/shared/types';

export const ipoService = {
  async getIPOs(filter?: { status?: string; category?: string }) {
    const params = new URLSearchParams(filter as any);
    return apiClient.get<IPO[]>(`/ipos?${params}`);
  },

  async getIPODetails(id: string) {
    return apiClient.get<IPO & { score: IPOScore }>(`/ipos/${id}`);
  },

  async getIPOScore(id: string) {
    return apiClient.get<IPOScore>(`/ipos/${id}/score`);
  },

  async addToWatchlist(ipoId: string) {
    return apiClient.post('/users/watchlist', { ipoId });
  },

  subscribeToUpdates(ipoId: string, callback: (data: any) => void) {
    const ws = new WebSocket(`${process.env.NEXT_PUBLIC_WS_URL}/ipos/${ipoId}`);
    ws.onmessage = (event) => callback(JSON.parse(event.data));
    return () => ws.close();
  },
};
```
