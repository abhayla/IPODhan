/**
 * SectorHeatMapDynamic - Code-split wrapper for SectorHeatMap
 *
 * Uses next/dynamic to automatically code-split D3.js bundle.
 */

import dynamic from 'next/dynamic';

export const SectorHeatMapDynamic = dynamic(
  () => import('./SectorHeatMap').then(mod => mod.SectorHeatMap),
  {
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 600, height: 400 }}>
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading heat map...
        </div>
      </div>
    ),
    ssr: false
  }
);

export default SectorHeatMapDynamic;
