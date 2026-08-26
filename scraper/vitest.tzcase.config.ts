import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * T-327F fix round 5: config for the TZ-explicit child cases.
 *
 * `tests/tz-cases/**` is intentionally excluded from the default
 * `tests/unit/**` include glob — those files assert timezone-specific
 * behaviour and are only meaningful when a parent driver spawns them with an
 * explicit `TZ` (and `TZCASE_EXPECT_TZ`) in the child env. Running them in the
 * normal suite would either fail (no expected-TZ set) or pass vacuously.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ['tests/tz-cases/**/*.test.ts'],
    },
  })
);
