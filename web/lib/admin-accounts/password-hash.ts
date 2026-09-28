/**
 * Admin password hashing with Node's built-in scrypt (no new dependency; OD-114).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` so the cost can be raised later
 * without invalidating existing hashes. Comparison is timing-safe.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const COST = { N: 16384, r: 8, p: 1 } as const;
// 128 * N * r * p = 16 MiB; the default maxmem (32 MiB) is enough, set explicitly for clarity.
const MAX_MEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { ...COST, maxmem: MAX_MEM });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Returns false (never throws) for a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map((v) => Number.parseInt(v, 10));
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await scrypt(password, salt, expected.length, { N, r, p, maxmem: MAX_MEM });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// A fixed hash used to spend the same scrypt time when the email is unknown or disabled, so the
// login response time does not reveal which emails are admin accounts.
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  if (!dummyHash) dummyHash = hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
