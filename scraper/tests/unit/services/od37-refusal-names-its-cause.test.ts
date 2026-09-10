/**
 * #582 — the download refusal asserted a cause it never established.
 *
 * `isResolvedAddressPrivate` returned a bare boolean. FIVE different outcomes
 * reached the caller as `true` — a genuinely private address, a hostname that
 * does not resolve, a lookup that timed out, an empty answer, and a malformed
 * DNS entry — and the caller logged every one of them as
 *
 *     "host REFUSED because it resolves to a private, loopback, link-local or
 *      metadata address"
 *
 * Measured on staging 2026-09-11: `www.hy{echengineers.com` — a stored company
 * URL corrupted by one character — was reported as a private-address refusal.
 * It does not resolve at all (ENOTFOUND), and the real host
 * `www.hytechengineers.com` resolves to two public Cloudflare addresses. A
 * data-corruption bug was wearing a security refusal's clothes, and nothing in
 * the log could tell them apart.
 *
 * The caller already had a separate `resolver_error` branch. It was DEAD CODE:
 * the resolver's own `catch` swallowed the throw and returned `true`, so a DNS
 * failure could never reach it.
 *
 * These cases pin the reason AND the evidence. The refusal behaviour itself is
 * unchanged and is asserted here too — this must fail closed exactly as before,
 * or the fix has traded a truthful log for a security hole.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', () => ({ default: { lookup }, lookup }));
vi.mock('dns/promises', () => ({ default: { lookup }, lookup }));

const { resolveHostVerdict, isResolvedAddressPrivate } = await import(
  '../../../src/services/company-host-source.js'
);

afterEach(() => {
  lookup.mockReset();
});

describe('resolveHostVerdict names the cause it actually established', () => {
  it('a host that does not resolve is dns_unresolvable, NOT a private address', async () => {
    // This is the staging case, verbatim.
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND www.hy{echengineers.com'), {
      code: 'ENOTFOUND',
    });
    lookup.mockRejectedValueOnce(err);

    const v = await resolveHostVerdict('www.hy{echengineers.com');

    expect(v.refused, 'must still fail closed').toBe(true);
    expect(v.reason).toBe('dns_unresolvable');
    expect(v.reason).not.toBe('private_address');
    expect(v.addresses).toEqual([]);
    expect(String(v.cause)).toContain('ENOTFOUND');
  });

  it('a genuinely private address is private_address, and carries the address it saw', async () => {
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);

    const v = await resolveHostVerdict('localhost.evil.test');

    expect(v.refused).toBe(true);
    expect(v.reason).toBe('private_address');
    // The evidence. Without this a refusal cannot be audited afterwards, which
    // is what made the staging case unresolvable from its own log line.
    expect(v.addresses).toEqual(['127.0.0.1']);
  });

  it('the metadata address is still refused, and named', async () => {
    lookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const v = await resolveHostVerdict('metadata.test');
    expect(v.refused).toBe(true);
    expect(v.reason).toBe('private_address');
    expect(v.addresses).toEqual(['169.254.169.254']);
  });

  it('a public host is allowed, and says which addresses it allowed on', async () => {
    // The real www.hytechengineers.com answer.
    lookup.mockResolvedValueOnce([
      { address: '172.67.166.56', family: 4 },
      { address: '104.21.82.249', family: 4 },
    ]);

    const v = await resolveHostVerdict('www.hytechengineers.com');

    expect(v.refused).toBe(false);
    expect(v.reason).toBe('public_address');
    expect(v.addresses).toEqual(['172.67.166.56', '104.21.82.249']);
  });

  it('an empty answer is no_addresses, and still refused', async () => {
    lookup.mockResolvedValueOnce([]);
    const v = await resolveHostVerdict('empty.test');
    expect(v.refused).toBe(true);
    expect(v.reason).toBe('no_addresses');
  });

  it('a malformed entry is malformed_dns_answer, and still refused', async () => {
    lookup.mockResolvedValueOnce([{ address: undefined as unknown as string, family: 4 }]);
    const v = await resolveHostVerdict('malformed.test');
    expect(v.refused).toBe(true);
    expect(v.reason).toBe('malformed_dns_answer');
  });

  it('a private address WINS over a malformed sibling entry', async () => {
    // Order matters: a malformed entry must never relabel a genuinely private
    // answer as a parsing problem, or the security finding gets downgraded to
    // a data-quality one.
    lookup.mockResolvedValueOnce([
      { address: undefined as unknown as string, family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const v = await resolveHostVerdict('mixed.test');
    expect(v.reason).toBe('private_address');
  });

  it('one private address among public ones still refuses the host', async () => {
    lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.10', family: 4 },
    ]);
    const v = await resolveHostVerdict('dns-rebind.test');
    expect(v.refused).toBe(true);
    expect(v.reason).toBe('private_address');
  });
});

describe('the boolean face still behaves exactly as before', () => {
  // The fix must not weaken the guard. Every case that refused before refuses
  // now, through the same exported function, for callers not yet migrated.
  it.each([
    ['private', [{ address: '127.0.0.1', family: 4 }], true],
    ['public', [{ address: '93.184.216.34', family: 4 }], false],
    ['empty', [], true],
  ] as const)('%s -> %s', async (_label, answer, expected) => {
    lookup.mockResolvedValueOnce(answer as never);
    expect(await isResolvedAddressPrivate('h.test')).toBe(expected);
  });

  it('a rejected lookup still refuses rather than throwing out', async () => {
    lookup.mockRejectedValueOnce(new Error('boom'));
    await expect(isResolvedAddressPrivate('h.test')).resolves.toBe(true);
  });
});
