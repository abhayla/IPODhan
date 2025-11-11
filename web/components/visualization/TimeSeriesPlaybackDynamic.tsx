/**
 * TimeSeriesPlaybackDynamic - Code-split wrapper for TimeSeriesPlayback
 *
 * Uses next/dynamic to automatically code-split D3.js bundle.
 */

import dynamic from 'next/dynamic';

export const TimeSeriesPlaybackDynamic = dynamic(
  () => import('./TimeSeriesPlayback').then(mod => mod.TimeSeriesPlayback),
  {
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 700, height: 350 }}>
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading timeline...
        </div>
      </div>
    ),
    ssr: false
  }
);

export default TimeSeriesPlaybackDynamic;
