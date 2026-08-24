// Fixture: reading a flag off process.env here does NOT count as a live
// consumer -- only a USE of the resulting value elsewhere does.
export const FEATURE_FLAGS = {
  enableBseApi: process.env.ENABLE_BSE_API === 'true',
  enablePrimarySourceDiscovery: process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY === 'true',
};
