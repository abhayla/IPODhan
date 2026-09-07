export const FEATURE_FLAGS = {
  CONSOLIDATION_PERCENTAGE: parseInt(
    process.env.CONSOLIDATION_PERCENTAGE || '0'
  ), // LIVE-GATE reworded, no longer on the key's own line
  ENABLE_DATA_CONSOLIDATION: process.env.ENABLE_DATA_CONSOLIDATION === 'true', // this flag matters (marker text changed)
};
