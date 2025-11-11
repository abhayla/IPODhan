/**
 * PredictiveMeterDynamic - Code-split wrapper for PredictiveMeter
 *
 * Uses next/dynamic to automatically code-split D3.js bundle.
 */

import dynamic from 'next/dynamic';

export const PredictiveMeterDynamic = dynamic(
  () => import('./PredictiveMeter').then(mod => mod.PredictiveMeter),
  {
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 300, height: 250 }}>
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading gauge...
        </div>
      </div>
    ),
    ssr: false
  }
);

export default PredictiveMeterDynamic;
