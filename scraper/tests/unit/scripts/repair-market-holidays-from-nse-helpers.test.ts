import { describe, it, expect } from 'vitest';
import { checkAnswerFileAge, holidayCacheDropCommand } from '../../../src/services/market-holidays-reconcile';
import { repairToolRedisSlot } from '../../../scripts/lib/repair-tool';

/**
 * F-221: the printed Redis cleanup must name the REAL keys, which carry the slot prefix
 * (packages/shared/src/cache/redis-slot.ts: "staging:" / "prod:"), and must use SCAN, not KEYS.
 */
describe('holidayCacheDropCommand prints the slot-prefixed SCAN command for each target database', () => {
  const printed = (db: string) => {
    const { slot, dbIndex } = repairToolRedisSlot(db);
    return holidayCacheDropCommand(slot, dbIndex);
  };

  it('ipodhan_staging -> staging: prefix, db 1', () => {
    expect(printed('ipodhan_staging')).toBe(
      "redis-cli -n 1 --scan --pattern 'staging:market_holidays:*' | xargs -r redis-cli -n 1 DEL"
    );
  });

  it('ipodhan -> prod: prefix, db 0', () => {
    expect(printed('ipodhan')).toBe("redis-cli -n 0 --scan --pattern 'prod:market_holidays:*' | xargs -r redis-cli -n 0 DEL");
  });

  it('never the bare pattern, never KEYS', () => {
    for (const db of ['ipodhan_staging', 'ipodhan']) {
      expect(printed(db)).not.toContain("'market_holidays:*'");
      expect(printed(db)).not.toMatch(/\bKEYS\b/);
    }
  });
});

describe('checkAnswerFileAge: a saved NSE answer older than 7 days is refused unless --allow-old-answer', () => {
  const NOW = Date.UTC(2026, 9, 2, 12);
  const days = (n: number) => NOW - n * 86_400_000;

  it('a 2-day-old file is used', () => {
    const r = checkAnswerFileAge(days(2), NOW, false);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('2 day(s) old');
  });
  it('an 8-day-old file is refused and the age is printed', () => {
    const r = checkAnswerFileAge(days(8), NOW, false);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('8 day(s) old');
    expect(r.message).toContain('--allow-old-answer');
  });
  it('an 8-day-old file is used with --allow-old-answer, and says so', () => {
    const r = checkAnswerFileAge(days(8), NOW, true);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('--allow-old-answer');
  });
});
