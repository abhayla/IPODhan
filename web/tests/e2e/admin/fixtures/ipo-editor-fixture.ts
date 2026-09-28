/**
 * Test fixture for the IPO page editor e2e (spec §9.2 items 1, 2, 13, 24). Writes ONE fixture IPO, one
 * admin account and one session into the TEST database only; refuses any other database name.
 *
 * The issue-size values are the ones measured live on 2026-09-16 for Hero Motors (spec Appendix A,
 * `ipos.issue_size` capability note): the offer document printed Rs 10,000,000,000 while BSE's payload
 * gave 7,000,000,084. The fixture stores BSE's figure as the page's current value and the document's
 * as a witness, which is the real shape of the defect the editor exists to correct.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

export const FIXTURE_SLUG = 'a3-editor-fixture-motors-limited';
export const FIXTURE_EMAIL = 'a3-editor-fixture@ipodhan.test';
export const SESSION_COOKIE = 'ipodhan_admin_session';
export const DOC_ISSUE_SIZE = '10000000000';
export const BSE_ISSUE_SIZE = '7000000084';

function readEnvLocal(): Record<string, string> {
  try {
    const text = readFileSync(path.join(__dirname, '..', '..', '..', '..', '.env.local'), 'utf8');
    return Object.fromEntries(
      text
        .split(/\r?\n/)
        .filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
    );
  } catch {
    return {};
  }
}

export function fixtureDbConfig() {
  const env = { ...readEnvLocal(), ...process.env } as Record<string, string | undefined>;
  if (!env.DATABASE_HOST || !env.DATABASE_PASSWORD) return null;
  return {
    host: env.DATABASE_HOST,
    port: Number(env.DATABASE_PORT ?? 5432),
    database: env.DATABASE_NAME ?? '',
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    options: '-c timezone=UTC',
  };
}

async function connect(): Promise<Client> {
  const cfg = fixtureDbConfig();
  if (!cfg) throw new Error('ipo-editor fixture: no database configured');
  if (cfg.database !== 'ipodhan_test') throw new Error(`ipo-editor fixture refuses database "${cfg.database}"; it writes to ipodhan_test only`);
  const c = new Client(cfg);
  await c.connect();
  return c;
}

export interface EditorFixture {
  ipoId: string;
  slug: string;
  sessionToken: string;
}

export async function seedEditorFixture(): Promise<EditorFixture> {
  const c = await connect();
  try {
    await cleanup(c);
    const readAt = '2026-09-16 08:30:00';
    const ipo = await c.query<{ id: string }>(
      `INSERT INTO ipos (company_name, slug, status, offering_type, segment, listing_exchanges, issue_size, lot_size, price_range_min, price_range_max, open_date, close_date)
       VALUES ('A3 Editor Fixture Motors Limited', $1, 'UPCOMING', 'IPO', 'MAINBOARD', '["NSE","BSE"]'::jsonb, $2, 30, 480, 505, '2026-10-06', '2026-10-08')
       RETURNING id`,
      [FIXTURE_SLUG, BSE_ISSUE_SIZE]
    );
    const ipoId = ipo.rows[0].id;
    const witnesses = [
      { source: 'RHP', docType: 'RHP', value: DOC_ISSUE_SIZE, at: readAt, outcome: 'SUPPLIED' },
      { source: 'CHITTORGARH', value: null, at: readAt, outcome: 'NOT_PRINTED', cause: 'not_printed' },
    ];
    await c.query(
      `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, witnesses, updated_at, updated_by)
       VALUES ($1, 'ipos', '', 'issueSize', 'BSE', 90, $2::jsonb, $3, 'SYSTEM')`,
      [ipoId, JSON.stringify(witnesses), readAt]
    );
    const user = await c.query<{ id: string }>(
      `INSERT INTO admin_users (name, email, phone, password_hash, is_owner) VALUES ('A3 Fixture Admin', $1, '+910000000000', 'fixture-no-login', false) RETURNING id`,
      [FIXTURE_EMAIL]
    );
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await c.query(
      `INSERT INTO admin_sessions (id, admin_user_id, created_at, last_seen_at, expires_at) VALUES ($1, $2, now(), now(), now() + interval '1 day')`,
      [hash, user.rows[0].id]
    );
    return { ipoId, slug: FIXTURE_SLUG, sessionToken: token };
  } finally {
    await c.end();
  }
}

async function cleanup(c: Client) {
  const ids = (await c.query<{ id: string }>(`SELECT id FROM ipos WHERE slug = $1`, [FIXTURE_SLUG])).rows.map((r) => r.id);
  for (const id of ids) {
    for (const t of ['audit_logs', 'field_protection_metadata', 'field_sources', 'ipo_field_plan', 'ipo_details']) {
      await c.query(`DELETE FROM ${t} WHERE ipo_id = $1`, [id]);
    }
    await c.query(`DELETE FROM ipos WHERE id = $1`, [id]);
  }
  await c.query(`DELETE FROM admin_users WHERE email = $1`, [FIXTURE_EMAIL]);
}

export async function removeEditorFixture(): Promise<void> {
  const c = await connect();
  try {
    await cleanup(c);
  } finally {
    await c.end();
  }
}

/** Read back the stored value and its provenance (the proof reads the database, not only the page). */
export async function readIssueSize(ipoId: string): Promise<{ issueSize: string | null; source: string | null }> {
  const c = await connect();
  try {
    const r = await c.query(
      `SELECT i.issue_size::text AS issue_size, fs.source::text AS source FROM ipos i LEFT JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name='ipos' AND fs.field_name='issueSize' WHERE i.id = $1`,
      [ipoId]
    );
    return { issueSize: r.rows[0]?.issue_size ?? null, source: r.rows[0]?.source ?? null };
  } finally {
    await c.end();
  }
}
