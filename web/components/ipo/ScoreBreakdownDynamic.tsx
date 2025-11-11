/**
 * ScoreBreakdownDynamic - Code-split wrapper for ScoreBreakdown
 *
 * Uses next/dynamic to automatically code-split D3.js bundle (~200KB).
 * This ensures D3.js is only loaded when the radar chart is actually displayed.
 *
 * Usage:
 * import { ScoreBreakdownDynamic } from '@/components/ipo/ScoreBreakdownDynamic';
 * <ScoreBreakdownDynamic data={scoreData} />
 */

import dynamic from 'next/dynamic';

// Dynamic import with loading state
export const ScoreBreakdownDynamic = dynamic(
  () => import('./ScoreBreakdown').then(mod => mod.ScoreBreakdown),
  {
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 280, height: 280 }}>
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading chart...
        </div>
      </div>
    ),
    ssr: false // Disable SSR for D3.js (browser-only)
  }
);

export default ScoreBreakdownDynamic;
