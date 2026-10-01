import { describe, it, expect } from 'vitest';
import { createTestPoolFromUrl, assertConnectedToTestDatabase, databaseNameOfUrl } from '../../test-utils/db';

describe('test pool guard (only ipodhan_test)', () => {
  it.each([
    'postgres://u:p@localhost:15432/ipodhan_prod',
    'postgres://u:p@localhost:15432/ipodhan_staging',
    'postgres://u:p@localhost:15432/ipodhan_test2',
    'postgres://u:p@localhost:15432/',
    'not a url',
  ])('refuses %s before connecting, without echoing the URL', (url) => {
    let msg = '';
    try { createTestPoolFromUrl(url); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/Refusing/);
    expect(msg).not.toContain('u:p');
  });

  it('accepts exactly ipodhan_test (pool object only, no connection made)', async () => {
    const pool = createTestPoolFromUrl('postgres://u:p@localhost:15432/ipodhan_test');
    expect(databaseNameOfUrl('postgres://u:p@localhost:15432/ipodhan_test')).toBe('ipodhan_test');
    await pool.end();
  });

  it('post-connect check refuses any other current_database()', async () => {
    await expect(assertConnectedToTestDatabase({ query: async () => ({ rows: [{ d: 'ipodhan' }] }) } as never)).rejects.toThrow(/Refusing/);
    await expect(assertConnectedToTestDatabase({ query: async () => ({ rows: [{ d: 'ipodhan_test' }] }) } as never)).resolves.toBeUndefined();
  });
});
