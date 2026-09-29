/**
 * §9.2 items 16 and 25 (OD-112, OD-93 shape): admin alerts through the REAL sendOwnerAlert against a
 * local HTTP stub standing in for the Notifier. No real Notifier is ever reached: NOTIFIER_URL points at
 * 127.0.0.1 for the duration of each test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { sendOwnerAlert } from '../../../src/services/owner-notify.js';
import {
  sendAdminInstant,
  runAdminDigest,
  buildAdminDigest,
  eventDay,
  instantKey,
  DIGEST_MAX_IPOS,
  ADMIN_INSTANT_CAP_PER_WAKE,
  beginAdminAlertWake,
  scanNewDisagreements,
  publicBaseUrl,
  editorLink,
  type NewConflictRow,
  type AdminAlertDeps,
  type AdminInstantEvent,
  type QueueCountRow,
  type RecordedAdminEvent,
} from '../../../src/services/admin-alerts.js';

interface Received {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

let server: http.Server;
let received: Received[] = [];
let nextStatus = 200;
const savedEnv = { ...process.env };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(raw) });
      res.statusCode = nextStatus;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  beginAdminAlertWake();
  received = [];
  nextStatus = 200;
  process.env.NOTIFIER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.NOTIFIER_KEY = 'test-key';
  process.env.NOTIFIER_PROJECT = 'ipodhan';
  process.env.ADMIN_ALERT_BASE_URL = 'https://staging.example.test';
});

afterEach(() => {
  process.env = { ...savedEnv };
});

function memoryDeps(now: Date, recorded: RecordedAdminEvent[] = [], claims = new Set<string>()): AdminAlertDeps & { claims: Set<string> } {
  return {
    now,
    env: 'staging',
    claims,
    isClaimed: async (k) => claims.has(k),
    claim: async (k) => {
      claims.add(k);
    },
    send: sendOwnerAlert,
    record: async (e) => {
      recorded.push(e);
    },
  };
}

// 2026-09-29 14:00 IST
const NOON_IST = new Date('2026-09-29T08:30:00Z');

const openEvent: AdminInstantEvent = {
  type: 'od106-exchange-replaced',
  ipoId: '11111111-1111-1111-1111-111111111111',
  slug: 'anand-seamless-ltd',
  companyName: 'Anand Seamless Ltd',
  status: 'OPEN',
  field: 'ipos.closeDate',
  detail: 'admin 2026-10-01, NSE now 2026-10-03',
};

describe('sendAdminInstant (OD-112 instant level, item 25 dedupe)', () => {
  it('sends exactly one POST per IPO + event type + IST day, with the gateway payload', async () => {
    const deps = memoryDeps(NOON_IST);
    const first = await sendAdminInstant(openEvent, deps);
    const second = await sendAdminInstant(openEvent, deps);
    const third = await sendAdminInstant({ ...openEvent, detail: 'another change same day' }, deps);

    expect(first).toEqual({ outcome: 'sent', key: 'admin-od106-exchange-replaced:staging:11111111-1111-1111-1111-111111111111:2026-09-29' });
    expect(second.outcome).toBe('already-sent');
    expect(third.outcome).toBe('already-sent');
    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    expect(headers['x-api-key']).toBe('test-key');
    expect(body.project).toBe('ipodhan');
    expect(body.severity).toBe('P2');
    expect(body.title).toContain('[staging]');
    expect(body.title).toContain('Anand Seamless Ltd');
    expect(body.dedupeKey).toBe(first.outcome === 'sent' ? first.key : '');
    expect(String(body.body)).toContain('https://staging.example.test/ipos/anand-seamless-ltd?edit=ipos.closeDate');
    // No admin identity is ever put in the payload (OD-114).
    expect(Object.keys(body).sort()).toEqual(['body', 'dedupeKey', 'project', 'severity', 'title', 'type']);
  });

  it('a different event type on the same IPO and day is its own alert', async () => {
    const deps = memoryDeps(NOON_IST);
    await sendAdminInstant(openEvent, deps);
    await sendAdminInstant({ ...openEvent, type: 'new-disagreement', field: 'ipos.issueSize' }, deps);
    expect(received).toHaveLength(2);
  });

  it('a 500 from the Notifier writes no claim, and the next call retries and sends', async () => {
    const deps = memoryDeps(NOON_IST);
    nextStatus = 500;
    const failed = await sendAdminInstant(openEvent, deps);
    expect(failed.outcome).toBe('unsent');
    expect(failed.outcome === 'unsent' && failed.reason).toContain('500');
    expect(deps.claims.size).toBe(0);

    nextStatus = 200;
    const retried = await sendAdminInstant(openEvent, deps);
    expect(retried.outcome).toBe('sent');
    expect(received).toHaveLength(2);
    expect(deps.claims.size).toBe(1);
  });

  it('an unconfigured Notifier is unsent with its reason and writes no claim', async () => {
    delete process.env.NOTIFIER_URL;
    const deps = memoryDeps(NOON_IST);
    const out = await sendAdminInstant(openEvent, deps);
    expect(out.outcome).toBe('unsent');
    expect(out.outcome === 'unsent' && out.reason).toContain('not configured');
    expect(deps.claims.size).toBe(0);
  });

  it.each(['CLOSED', 'LISTED', 'WITHDRAWN'])('a %s IPO gets no POST: the event goes to the digest store', async (status) => {
    const recorded: RecordedAdminEvent[] = [];
    const deps = memoryDeps(NOON_IST, recorded);
    const out = await sendAdminInstant({ ...openEvent, status }, deps);
    expect(out).toEqual({ outcome: 'digest' });
    expect(received).toHaveLength(0);
    expect(deps.claims.size).toBe(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ slug: 'anand-seamless-ltd', status, type: 'od106-exchange-replaced', at: NOON_IST.toISOString() });
  });

  it('UPCOMING is instant too', async () => {
    await sendAdminInstant({ ...openEvent, status: 'UPCOMING' }, memoryDeps(NOON_IST));
    expect(received).toHaveLength(1);
  });

  it('23:59 IST and 00:01 IST are different IST days: two alerts', async () => {
    const claims = new Set<string>();
    const lateNight = new Date('2026-09-29T18:29:00Z'); // 23:59 IST on 29 Sep
    const justAfter = new Date('2026-09-29T18:31:00Z'); // 00:01 IST on 30 Sep
    const a = await sendAdminInstant(openEvent, memoryDeps(lateNight, [], claims));
    const b = await sendAdminInstant(openEvent, memoryDeps(justAfter, [], claims));
    expect(a.outcome === 'sent' && a.key.endsWith(':2026-09-29')).toBe(true);
    expect(b.outcome === 'sent' && b.key.endsWith(':2026-09-30')).toBe(true);
    expect(received).toHaveLength(2);
  });

  it('keys follow the documented shape', () => {
    expect(instantKey('new-disagreement', 'prod', 'x', '2026-09-29')).toBe('admin-new-disagreement:prod:x:2026-09-29');
  });
});

// Queue-shaped rows as dbQueueCountsLoader returns them (slugs from staging's 2026-09-24 live set).
const counts: QueueCountRow[] = [
  { ipoId: 'l1', slug: 'old-listed-ltd', companyName: 'Old Listed Ltd', status: 'LISTED', nearest: '2026-08-01', disagreements: 2, missing: 40 },
  { ipoId: 'l2', slug: 'newer-listed-ltd', companyName: 'Newer Listed Ltd', status: 'LISTED', nearest: '2026-09-20', disagreements: 0, missing: 5 },
  { ipoId: 'o1', slug: 'anand-seamless-ltd', companyName: 'Anand Seamless Ltd', status: 'OPEN', nearest: '2026-10-01', disagreements: 3, missing: 12 },
  { ipoId: 'u1', slug: 's-k-offset-ltd', companyName: 'S K Offset Ltd', status: 'UPCOMING', nearest: '2026-09-30', disagreements: 0, missing: 7 },
  { ipoId: 'z', slug: 'nothing-open-ltd', companyName: 'Nothing Open Ltd', status: 'OPEN', nearest: '2026-10-02', disagreements: 0, missing: 0 },
];

function digestDeps(now: Date, claims = new Set<string>(), events: RecordedAdminEvent[] = []) {
  return {
    now,
    env: 'staging',
    isClaimed: async (k: string) => claims.has(k),
    claim: async (k: string) => {
      claims.add(k);
    },
    send: sendOwnerAlert,
    loadQueueCounts: async () => counts,
    loadEvents: async () => events,
  };
}

describe('runAdminDigest (OD-112 digest at 09:00 IST, no new cron)', () => {
  it('before 09:00 IST it is not due and sends nothing', async () => {
    const r = await runAdminDigest(digestDeps(new Date('2026-09-29T03:29:00Z'))); // 08:59 IST
    expect(r).toMatchObject({ due: false, sent: false, day: '2026-09-29' });
    expect(received).toHaveLength(0);
  });

  it('sends once per IST day at the first wake at or after 09:00 IST', async () => {
    const claims = new Set<string>();
    const r1 = await runAdminDigest(digestDeps(new Date('2026-09-29T03:30:00Z'), claims)); // 09:00 IST
    const r2 = await runAdminDigest(digestDeps(new Date('2026-09-29T04:00:00Z'), claims)); // 09:30 IST
    const r3 = await runAdminDigest(digestDeps(new Date('2026-09-29T18:29:00Z'), claims)); // 23:59 IST
    expect(r1).toMatchObject({ due: true, sent: true, key: 'admin-digest:staging:2026-09-29', ipos: 4 });
    expect(r2).toMatchObject({ alreadySent: true, sent: false });
    expect(r3).toMatchObject({ alreadySent: true, sent: false });
    expect(received).toHaveLength(1);
    expect(received[0].body.dedupeKey).toBe('admin-digest:staging:2026-09-29');
    expect(received[0].body.severity).toBe('P2');
    // The next IST day (00:01 IST is still before 09:00, so not due; 09:00 sends day 2).
    const r4 = await runAdminDigest(digestDeps(new Date('2026-09-29T18:31:00Z'), claims));
    expect(r4.due).toBe(false);
    const r5 = await runAdminDigest(digestDeps(new Date('2026-09-30T03:30:00Z'), claims));
    expect(r5).toMatchObject({ sent: true, day: '2026-09-30' });
    expect(received).toHaveLength(2);
  });

  it('a 500 leaves the day unclaimed and the next wake sends it', async () => {
    const claims = new Set<string>();
    nextStatus = 500;
    const r1 = await runAdminDigest(digestDeps(new Date('2026-09-29T03:30:00Z'), claims));
    expect(r1).toMatchObject({ due: true, sent: false });
    expect(r1.reason).toContain('500');
    expect(claims.size).toBe(0);
    nextStatus = 200;
    const r2 = await runAdminDigest(digestDeps(new Date('2026-09-29T04:00:00Z'), claims));
    expect(r2.sent).toBe(true);
    expect(received).toHaveLength(2);
  });

  it('groups by IPO, live first (nearest date), listed newest first, with counts, events and editor links', async () => {
    const events: RecordedAdminEvent[] = [
      { at: '2026-09-29T02:00:00.000Z', type: 'od106-exchange-replaced', ipoId: 'l1', slug: 'old-listed-ltd', companyName: 'Old Listed Ltd', status: 'LISTED', field: 'closeDate', detail: 'a' },
      // the same event from the audit trail (naive UTC text, table-qualified field): counted once
      { at: '2026-09-29 02:00:05.123', type: 'od106-exchange-replaced', ipoId: 'l1', slug: 'old-listed-ltd', companyName: 'Old Listed Ltd', status: 'LISTED', field: 'ipos.closeDate', detail: 'b' },
    ];
    await runAdminDigest(digestDeps(new Date('2026-09-29T03:30:00Z'), new Set(), events));
    const body = String(received[0].body.body);
    const lines = body.split('\n');
    expect(lines[0]).toBe('4 IPO(s) need attention (2 live): 5 disagreement(s), 64 missing value(s), 1 event(s) in the last 24 h.');
    expect(lines[1]).toBe('- S K Offset Ltd (UPCOMING): 7 missing - https://staging.example.test/ipos/s-k-offset-ltd?edit=');
    expect(lines[2]).toBe('- Anand Seamless Ltd (OPEN): 3 disagreement(s); 12 missing - https://staging.example.test/ipos/anand-seamless-ltd?edit=');
    expect(lines[3]).toContain('Newer Listed Ltd (LISTED)');
    expect(lines[4]).toBe('- Old Listed Ltd (LISTED): 2 disagreement(s); 40 missing; Exchange replaced an admin date (closeDate) x1 - https://staging.example.test/ipos/old-listed-ltd?edit=');
    expect(body).not.toContain('Nothing Open Ltd');
    expect(String(received[0].body.title)).toBe('[staging] Admin digest 2026-09-29: 4 IPO(s), 2 live');
  });

  it(`caps the message at ${DIGEST_MAX_IPOS} IPOs and points at the full queue`, () => {
    const many: QueueCountRow[] = Array.from({ length: DIGEST_MAX_IPOS + 3 }, (_, i) => ({
      ipoId: `i${i}`, slug: `ipo-${String(i).padStart(2, '0')}`, companyName: `IPO ${i}`, status: 'LISTED', nearest: null, disagreements: 1, missing: 0,
    }));
    const d = buildAdminDigest(many, [], { env: 'prod', day: '2026-09-29' });
    const lines = d.body.split('\n');
    expect(lines).toHaveLength(1 + DIGEST_MAX_IPOS + 1);
    expect(lines[lines.length - 1]).toBe('... and 3 more IPO(s); full list: https://staging.example.test/admin/conflicts');
    expect(d.ipos).toBe(DIGEST_MAX_IPOS + 3);
  });

  it('an empty day still sends a digest, so silence never looks like a broken digest', async () => {
    const r = await runAdminDigest({ ...digestDeps(new Date('2026-09-29T03:30:00Z')), loadQueueCounts: async () => [] });
    expect(r.sent).toBe(true);
    expect(String(received[0].body.body)).toContain('0 IPO(s) need attention');
  });
});

describe('eventDay (ist-timezone rule)', () => {
  it('reads naive audit text as UTC, not local time', () => {
    expect(eventDay('2026-09-29 18:29:00')).toBe('2026-09-29'); // 23:59 IST
    expect(eventDay('2026-09-29 18:31:00')).toBe('2026-09-30'); // 00:01 IST
    expect(eventDay('2026-09-29T18:31:00.000Z')).toBe('2026-09-30');
  });
});

// ------------------------------------------------ review fix round (PR #1284)

function conflictRow(i: number, over: Partial<NewConflictRow> = {}): NewConflictRow {
  const id = `22222222-2222-2222-2222-${String(i).padStart(12, '0')}`;
  return {
    conflictId: `c-${i}`,
    ipoId: id,
    slug: `ipo-${i}`,
    companyName: `IPO ${i} Ltd`,
    status: 'OPEN',
    tableName: 'ipos',
    fieldName: 'issueSize',
    source1: 'NSE',
    value1: '100',
    source2: 'BSE',
    value2: '120',
    documentId: null,
    ...over,
  };
}

function scanDeps(rows: NewConflictRow[], alert: AdminAlertDeps, mark: { at: Date | null } = { at: null }) {
  const sinceSeen: Date[] = [];
  return {
    mark,
    sinceSeen,
    deps: {
      now: NOON_IST,
      loadNewConflicts: async (since: Date) => {
        sinceSeen.push(since);
        return rows;
      },
      getMark: async () => mark.at,
      setMark: async (at: Date) => {
        mark.at = at;
      },
      alert,
    },
  };
}

describe('scanNewDisagreements (the real instant emitter, MAJOR)', () => {
  it('a new cross-source disagreement on an OPEN IPO sends exactly one POST of type admin-new-disagreement', async () => {
    const s = scanDeps([conflictRow(1)], memoryDeps(NOON_IST));
    const r = await scanNewDisagreements(s.deps);
    expect(received).toHaveLength(1);
    expect(received[0].body.type).toBe('admin-new-disagreement');
    expect(String(received[0].body.body)).toContain('NSE 100 vs BSE 120');
    expect(String(received[0].body.body)).toContain('https://staging.example.test/ipos/ipo-1?edit=ipos.issueSize');
    expect(r).toMatchObject({ scanned: 1, markAdvanced: true });
    expect(r.outcomes.sent).toBe(1);
    expect(s.mark.at?.toISOString()).toBe(NOON_IST.toISOString());
    // The first scan ever looks back one hour.
    expect(s.sinceSeen[0].toISOString()).toBe(new Date(NOON_IST.getTime() - 3_600_000).toISOString());
  });

  it('a newer document (corrigendum) disagreeing with an ADMIN value sends one admin-newer-document-disagrees', async () => {
    const row = conflictRow(2, {
      source1: 'ADMIN',
      value1: '2026-10-01',
      source2: 'DRHP',
      value2: '2026-10-03',
      fieldName: 'closeDate',
      documentId: 'doc-1',
    });
    const s = scanDeps([row], memoryDeps(NOON_IST));
    await scanNewDisagreements(s.deps);
    expect(received).toHaveLength(1);
    expect(received[0].body.type).toBe('admin-newer-document-disagrees');
    expect(String(received[0].body.body)).toContain('admin value 2026-10-01; a newer document says 2026-10-03');
  });

  it(`caps instant sends per wake at ${ADMIN_INSTANT_CAP_PER_WAKE}; the rest go to the digest store`, async () => {
    const recorded: RecordedAdminEvent[] = [];
    const rows = Array.from({ length: 50 }, (_, i) => conflictRow(i + 1));
    const s = scanDeps(rows, memoryDeps(NOON_IST, recorded));
    const r = await scanNewDisagreements(s.deps);
    expect(received).toHaveLength(ADMIN_INSTANT_CAP_PER_WAKE);
    expect(r.outcomes).toMatchObject({ sent: ADMIN_INSTANT_CAP_PER_WAKE, capped: 50 - ADMIN_INSTANT_CAP_PER_WAKE });
    expect(recorded).toHaveLength(50 - ADMIN_INSTANT_CAP_PER_WAKE);
    expect(recorded[0].type).toBe('new-disagreement');
    // A new wake gets a fresh cap.
    beginAdminAlertWake();
    await scanNewDisagreements(scanDeps([conflictRow(99)], memoryDeps(NOON_IST)).deps);
    expect(received).toHaveLength(ADMIN_INSTANT_CAP_PER_WAKE + 1);
  });

  it('a Notifier 500 keeps the mark, so the next wake retries the row', async () => {
    nextStatus = 500;
    const s = scanDeps([conflictRow(3)], memoryDeps(NOON_IST), { at: new Date('2026-09-29T08:00:00Z') });
    const r = await scanNewDisagreements(s.deps);
    expect(r.markAdvanced).toBe(false);
    expect(s.mark.at?.toISOString()).toBe('2026-09-29T08:00:00.000Z');
    expect(s.sinceSeen[0].toISOString()).toBe('2026-09-29T08:00:00.000Z');
  });
});

describe('claim write failure after a successful send (MINOR 3)', () => {
  it('reports sent, never throws, and sends once', async () => {
    const deps = memoryDeps(NOON_IST);
    deps.claim = async () => {
      throw new Error('redis down');
    };
    const out = await sendAdminInstant(openEvent, deps);
    expect(out.outcome).toBe('sent');
    expect(received).toHaveLength(1);
    expect(received[0].body.dedupeKey).toBe(instantKey(openEvent.type, 'staging', openEvent.ipoId, '2026-09-29'));
  });
});

describe('digest window starts at the last successful digest (MINOR 4)', () => {
  const NINE_THIRTY_IST = new Date('2026-09-29T04:00:00Z');
  function digestDeps(last: Date | null) {
    const seen: Date[] = [];
    const marks: Date[] = [];
    return {
      seen,
      marks,
      deps: {
        now: NINE_THIRTY_IST,
        env: 'staging',
        isClaimed: async () => false,
        claim: async () => {},
        send: sendOwnerAlert,
        loadQueueCounts: async () => [],
        loadEvents: async (since: Date) => {
          seen.push(since);
          return [];
        },
        lastSentAt: async () => last,
        markSent: async (at: Date) => {
          marks.push(at);
        },
      },
    };
  }

  it('a late send (last digest 30 h ago) reads events since that send, not now - 24 h', async () => {
    const last = new Date(NINE_THIRTY_IST.getTime() - 30 * 3_600_000);
    const d = digestDeps(last);
    const r = await runAdminDigest(d.deps);
    expect(r.sent).toBe(true);
    expect(d.seen[0].toISOString()).toBe(last.toISOString());
    expect(String(received[0].body.body)).toContain(`since the last digest (${last.toISOString()})`);
    expect(d.marks.map((x) => x.toISOString())).toEqual([NINE_THIRTY_IST.toISOString()]);
  });

  it('the first digest ever looks back 24 h', async () => {
    const d = digestDeps(null);
    await runAdminDigest(d.deps);
    expect(d.seen[0].toISOString()).toBe(new Date(NINE_THIRTY_IST.getTime() - 86_400_000).toISOString());
  });

  it('a failed send does not move the last-sent mark', async () => {
    nextStatus = 500;
    const d = digestDeps(null);
    const r = await runAdminDigest(d.deps);
    expect(r.sent).toBe(false);
    expect(d.marks).toHaveLength(0);
  });
});

describe('absolute links per slot (MINOR 5)', () => {
  it('maps prod and staging to their public domains, and the override wins', () => {
    expect(publicBaseUrl({ DEPLOY_SLOT: 'prod' } as NodeJS.ProcessEnv)).toBe('https://ipodhan.com');
    expect(publicBaseUrl({ DEPLOY_SLOT: 'staging' } as NodeJS.ProcessEnv)).toBe('https://staging.ipodhan.com');
    expect(publicBaseUrl({ DEPLOY_SLOT: 'prod', ADMIN_ALERT_BASE_URL: 'https://x.test/' } as NodeJS.ProcessEnv)).toBe('https://x.test');
  });

  it('an alert link is absolute with no URL key in the env (the real scraper.env shape)', () => {
    delete process.env.ADMIN_ALERT_BASE_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.DEPLOY_SLOT = 'prod';
    expect(editorLink('anand-seamless-ltd', 'ipos.closeDate')).toBe('https://ipodhan.com/ipos/anand-seamless-ltd?edit=ipos.closeDate');
    expect(editorLink('x')).toMatch(/^https:\/\//);
  });
});
