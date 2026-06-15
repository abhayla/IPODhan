import { describe, it, expect, afterAll } from 'vitest';
import { pool } from '@ipodhan/shared/db';

/**
 * #28 integration guarantee: every connection from the shared pool runs with the
 * session timezone forced to UTC (via `options: '-c timezone=UTC'`), so now()/
 * defaultNow() write UTC-naive and now()-relative comparisons treat naive values
 * as UTC. A unit test cannot catch a pool-config regression — this can.
 */
describe('shared pool session timezone (#28)', () => {
  afterAll(async () => {
    await (pool as any).end?.();
  });

  it('forces SHOW timezone = UTC on a live connection', async () => {
    const { rows } = await (pool as any).query('SHOW timezone');
    expect(rows[0].TimeZone).toBe('UTC');
  });

  it('writes now() into a naive timestamp column as UTC-naive (matches UTC wall-clock)', async () => {
    await (pool as any).query('CREATE TEMP TABLE _tz_check (ts timestamp without time zone)');
    await (pool as any).query('INSERT INTO _tz_check VALUES (now())');
    const { rows } = await (pool as any).query(
      `SELECT to_char(ts,'YYYY-MM-DD HH24:MI') AS stored,
              to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS utc_now FROM _tz_check`
    );
    expect(rows[0].stored).toBe(rows[0].utc_now);
  });
});
