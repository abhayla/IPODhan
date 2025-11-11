/**
 * CorrelationMatrixDynamic - Code-split wrapper for CorrelationMatrix
 *
 * Uses next/dynamic to automatically code-split D3.js bundle.
 */

import dynamic from 'next/dynamic';

export const CorrelationMatrixDynamic = dynamic(
  () => import('./CorrelationMatrix').then(mod => mod.CorrelationMatrix),
  {
    loading: () => (
      <div className="flex items-center justify-center" style={{ width: 600, height: 400 }}>
        <div className="text-sm text-muted-foreground animate-pulse">
          Loading scatter plot...
        </div>
      </div>
    ),
    ssr: false
  }
);

export default CorrelationMatrixDynamic;
