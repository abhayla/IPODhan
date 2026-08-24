// Fixture "prod entrypoint": a real consumer of ENABLE_BSE_API outside
// scheduler/ and outside config/feature-flags.ts.
import { FEATURE_FLAGS } from './config/feature-flags.js';

if (FEATURE_FLAGS.enableBseApi) {
  console.log('ENABLE_BSE_API is live here');
}
