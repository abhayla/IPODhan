/**
 * OD-173 section 3 (spec rows 154-158, Appendix A): the rebuilt General Information reader's
 * `brlm_contacts` (one row per BRLM block: SEBI no., contact person, phone, e-mail, grievance e-mail)
 * and `registrar_grievance_email` reach the existing ipo_intermediaries BRLM / REGISTRAR rows.
 *
 * Mirrors fix S (filing-persister-brlm-order-keeps-firm-fields.test.ts: values attach by the firm's
 * row key, never by position; a firm the run has nothing for keeps its stored columns) and the
 * promoter rows (filing-persister-promoter-rows.test.ts: the spec answer-state table "Answer states
 * for a re-read of the same document" (OD-153, OD-158), document rank (OD-30, OD-154), the admin hold).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock, recordDocumentSourceHints: vi.fn() }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// The GI reader has no stated-absence reason on the shared list today; one test-only reason stands in
// for "a reason on the list" so the STATED_NOT_PRINTED path is exercised as the table defines it.
const TEST_ABSENCE = 'test_only_issuer_states_no_brlm_contacts';
vi.mock('../../../src/config/stated-absence-reasons.js', async (orig) => {
  const real = (await orig()) as { isStatedAbsenceReason: (r: unknown) => boolean };
  return { ...real, isStatedAbsenceReason: (r: unknown) => r === TEST_ABSENCE || real.isStatedAbsenceReason(r) };
});

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';

const IPO_ID = 'c2c5d769-3ad1-4c6c-b58d-9f37965ee344';
const DOC_ID = '5ec5d769-3ad1-4c6c-b58d-9f37965ee355';
const OTHER_DOC = '6fc5d769-3ad1-4c6c-b58d-9f37965ee366';
type Field = FilingExtraction['fields'][string];
const value = (v: unknown, page: number): Field =>
  ({ value: v, page, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;
const nullField = (state: string, detail: string): Field =>
  ({ value: null, page: null, check: { name: 'c', passed: state === 'STATED_NOT_PRINTED', detail }, state }) as unknown as Field;

const KOTAK = 'Kotak Mahindra Capital Company Limited';
const JM = 'JM Financial Limited';
const AXIS = 'Axis Capital Limited';
const HELD = [KOTAK, JM];
const K = `BRLM:${rowKeyForName(KOTAK)}`;
const J = `BRLM:${rowKeyForName(JM)}`;
const REG = 'KFin Technologies Limited';
const RK = `REGISTRAR:${rowKeyForName(REG)}`;

type Contact = { name: string; sebi_reg_no?: string | null; contact_person?: string | null; phone?: string | null; email?: string | null; grievance_email?: string | null; page?: number };
const KOTAK_ROW: Contact = {
  name: KOTAK, sebi_reg_no: 'INM000008704', contact_person: 'Ganesh Rane', phone: '+91 22 4336 0000',
  email: 'nse.ipo@kotak.com', grievance_email: 'kmccredressal@kotak.com', page: 98,
};
const JM_ROW: Contact = {
  name: JM, sebi_reg_no: 'INM000010361', contact_person: 'Prachee Dhuri', phone: '+91 22 6630 3030',
  email: 'nse.ipo@jmfl.com', grievance_email: 'grievance.ibd@jmfl.com', page: 98,
};

type Stored = { role: string; name: string; sebiRegNo?: string | null; contactPerson?: string | null; phone?: string | null; email?: string | null; grievanceEmail?: string | null };
type Prov = { source?: string; dataLineage: Record<string, unknown> };

function extraction(fields: Record<string, Field>, docType: string): FilingExtraction {
  return {
    doc_type: docType, source_doc: `${docType}-5ec5d769.pdf`, pages: 520, extraction_status: 'OK', unit: 'millions',
    fiscal_years: [], fields,
  } as FilingExtraction;
}

/** provenance: key `${tableName}|${rowKey}|${fieldName}` -> record. */
function makeDeps(stored: Stored[], provenance: Record<string, Prov> = {}, registrar: string | null = REG) {
  const replaceForIpo = vi.fn(async () => []);
  const listByIpoAndRole = vi.fn(async (_ipoId: string, role: string) =>
    stored
      .filter((r) => r.role === role)
      .map((r) => ({
        id: `row-${r.name}`, ipoId: IPO_ID, normalizedName: rowKeyForName(r.name), sebiRegNo: null, contactPerson: null,
        phone: null, email: null, grievanceEmail: null, ...r,
      }))
  );
  const findByField = vi.fn(async (_ipo: string, table: string, field: string, rowKey = '') => {
    const p = provenance[`${table}|${rowKey}|${field}`];
    return p ? { source: p.source ?? 'RHP', dataLineage: p.dataLineage } : null;
  });
  const recordFailure = vi.fn(async () => ({}));
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [], leadManagers: HELD, registrar,
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo, listByIpoAndRole },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldExtractionFailures: { recordFailure, markResolved: vi.fn(async () => 0) },
    fieldSources: { findByField, trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: {
      upsert: vi.fn(async (_id: string, values: Record<string, unknown>, opts?: { afterWriteInTx?: (tx: unknown, w: Record<string, unknown>) => Promise<void> }) => {
        await opts?.afterWriteInTx?.('tx-1', values);
      }),
      insertIfMissing: vi.fn(async () => false),
    },
  } as unknown as FilingPersisterDeps;
  return { deps, replaceForIpo, listByIpoAndRole, findByField, recordFailure };
}

const run = (h: ReturnType<typeof makeDeps>, fields: Record<string, Field>, docType = 'RHP', documentId = DOC_ID) =>
  persistFilingExtraction(IPO_ID, extraction(fields, docType), { docType, documentId, extractorVersion: 'extract_filing.py@2026-10-07', apply: true } as never, h.deps);

const COLS = ['sebiRegNo', 'contactPerson', 'phone', 'email', 'grievanceEmail'] as const;
const rowsOf = (h: ReturnType<typeof makeDeps>) => (h.replaceForIpo.mock.calls[0]?.[1] ?? []) as Array<Record<string, unknown>>;
const firm = (h: ReturnType<typeof makeDeps>, role: string, name: string) => {
  const r = rowsOf(h).find((x) => x.role === role && x.name === name);
  return r ? Object.fromEntries(COLS.map((c) => [c, r[c] ?? null])) : undefined;
};
const intermediaryReceipts = (summary: Awaited<ReturnType<typeof persistFilingExtraction>>) =>
  (summary.receipt_fields ?? [])
    .filter((r) => r.tableName === 'ipo_intermediaries' && r.fieldName !== 'name' && r.fieldName !== 'role')
    .map((r) => `${r.rowKey}|${r.fieldName}|${r.value}`)
    .sort();
const keyedProvenance = (h: ReturnType<typeof makeDeps>) =>
  (h.deps.fieldSources.trackFieldUpdate as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((a) => a.tableName === 'ipo_intermediaries' && typeof a.rowKey === 'string' && (a.rowKey as string).includes(':') && !(a.rowKey as string).startsWith('unresolved:'))
    .map((a) => `${a.rowKey}|${a.fieldName}|${(a.dataLineage as Record<string, unknown>).documentId}`)
    .sort();
const origin = (rowKey: string, field: string, lin: Record<string, unknown>, source?: string): Record<string, Prov> => ({
  [`ipo_intermediaries|${rowKey}|${field}`]: { source, dataLineage: { extractorVersion: 'extract_filing.py@2026-10-04', ...lin } },
});
const STORED_KOTAK: Stored = {
  role: 'BRLM', name: KOTAK, sebiRegNo: 'INM000008704', contactPerson: 'Old Person', phone: '+91 22 1111 1111',
  email: 'old@kotak.com', grievanceEmail: 'old-redressal@kotak.com',
};

describe('filing-persister - brlm_contacts reach the BRLM rows', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('(1) two firms: each BRLM row carries its own five values; receipts and keyed provenance name this document', async () => {
    const h = makeDeps([]);
    const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([JM_ROW, KOTAK_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)).toEqual({
      sebiRegNo: 'INM000008704', contactPerson: 'Ganesh Rane', phone: '+91 22 4336 0000', email: 'nse.ipo@kotak.com', grievanceEmail: 'kmccredressal@kotak.com',
    });
    expect(firm(h, 'BRLM', JM)).toEqual({
      sebiRegNo: 'INM000010361', contactPerson: 'Prachee Dhuri', phone: '+91 22 6630 3030', email: 'nse.ipo@jmfl.com', grievanceEmail: 'grievance.ibd@jmfl.com',
    });
    expect(intermediaryReceipts(summary)).toEqual(
      [
        `${K}|sebiRegNo|INM000008704`, `${K}|contactPerson|Ganesh Rane`, `${K}|phone|+91 22 4336 0000`, `${K}|email|nse.ipo@kotak.com`, `${K}|grievanceEmail|kmccredressal@kotak.com`,
        `${J}|sebiRegNo|INM000010361`, `${J}|contactPerson|Prachee Dhuri`, `${J}|phone|+91 22 6630 3030`, `${J}|email|nse.ipo@jmfl.com`, `${J}|grievanceEmail|grievance.ibd@jmfl.com`,
      ].sort()
    );
    expect(keyedProvenance(h)).toEqual(
      [K, J].flatMap((k) => COLS.map((c) => `${k}|${c}|${DOC_ID}`)).sort()
    );
  });

  it('(2) a held firm missing from brlm_contacts keeps its stored values and gets no receipt', async () => {
    const h = makeDeps([STORED_KOTAK]);
    const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([JM_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)).toEqual({
      sebiRegNo: 'INM000008704', contactPerson: 'Old Person', phone: '+91 22 1111 1111', email: 'old@kotak.com', grievanceEmail: 'old-redressal@kotak.com',
    });
    expect(firm(h, 'BRLM', JM)?.contactPerson).toBe('Prachee Dhuri');
    expect(intermediaryReceipts(summary).filter((x) => x.startsWith(`${K}|`))).toEqual([]);
  });

  it('(2b) a firm row with a column left empty keeps that stored column (no answer state for one column)', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'phone', { documentId: DOC_ID, docType: 'RHP' }));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([{ ...KOTAK_ROW, phone: null }, JM_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)?.phone).toBe('+91 22 1111 1111');
    expect(firm(h, 'BRLM', KOTAK)?.contactPerson).toBe('Ganesh Rane');
  });

  it('(3) values attach by the firm row key, not by position; a firm outside the held list attaches nothing', async () => {
    const h = makeDeps([]);
    const summary = await run(h, {
      lead_managers: value([JM, KOTAK], 1),
      brlm_contacts: value([{ ...AXIS_ROW() }, { ...KOTAK_ROW, name: 'Kotak Mahindra Capital Company Ltd.' }, JM_ROW], 98),
    });
    expect(firm(h, 'BRLM', KOTAK)?.contactPerson).toBe('Ganesh Rane');
    expect(firm(h, 'BRLM', JM)?.contactPerson).toBe('Prachee Dhuri');
    expect(rowsOf(h).filter((r) => r.role === 'BRLM').map((r) => r.name)).toEqual(HELD);
    expect(intermediaryReceipts(summary).some((x) => x.includes('axis'))).toBe(false);
  });

  it('(3b) two brlm_contacts rows that normalise to one firm are ambiguous: nothing attaches for that firm', async () => {
    const h = makeDeps([]);
    const summary = await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: value([KOTAK_ROW, { ...KOTAK_ROW, name: 'Kotak Mahindra Capital Co. Ltd', phone: '+91 22 9999 9999' }, JM_ROW], 98),
    });
    expect(firm(h, 'BRLM', KOTAK)).toEqual({ sebiRegNo: null, contactPerson: null, phone: null, email: null, grievanceEmail: null });
    expect(firm(h, 'BRLM', JM)?.phone).toBe('+91 22 6630 3030');
    expect(summary.skipped_failed_check.some((s) => s.includes('brlm_contacts') && s.includes(K))).toBe(true);
  });

  it('(3c) the document names a different set of firms: nothing from brlm_contacts files on the held rows', async () => {
    const h = makeDeps([]);
    const summary = await run(h, { lead_managers: value([KOTAK, AXIS], 1), brlm_contacts: value([KOTAK_ROW, AXIS_ROW()], 98) });
    expect(firm(h, 'BRLM', KOTAK)?.contactPerson).toBeNull();
    expect(intermediaryReceipts(summary)).toEqual([]);
  });

  it('(3d) a malformed value in a row (not an e-mail, not an INM number) is not saved', async () => {
    const h = makeDeps([]);
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([{ ...KOTAK_ROW, email: 'not an email', sebi_reg_no: 'INR000000221' }, JM_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBeNull();
    expect(firm(h, 'BRLM', KOTAK)?.sebiRegNo).toBeNull();
  });
});

function AXIS_ROW(): Contact {
  return { name: AXIS, sebi_reg_no: 'INM000012029', contact_person: 'Harish Patel', phone: '+91 22 4325 2183', email: 'nse.ipo@axiscap.in', grievance_email: 'complaints@axiscap.in', page: 99 };
}

describe('filing-persister - brlm_contacts answer states (OD-153, OD-158) and document rank (OD-30, OD-154)', () => {
  beforeEach(() => upsertIPOMock.mockClear());
  const sameDoc = (field: string) => origin(K, field, { documentId: DOC_ID, docType: 'RHP' });

  it('same document, the reader refused brlm_contacts: the stored columns this document wrote are cleared', async () => {
    const h = makeDeps([STORED_KOTAK], { ...sameDoc('contactPerson'), ...sameDoc('grievanceEmail') });
    const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('REFUSED', 'brlm_block_values_format_checked') });
    // grievanceEmail is also produced by row 158 (brlm_grievance_emails), absent here = a miss: kept.
    expect(firm(h, 'BRLM', KOTAK)).toMatchObject({ contactPerson: null, grievanceEmail: 'old-redressal@kotak.com', phone: '+91 22 1111 1111', email: 'old@kotak.com' });
    expect(summary.skipped_failed_check).toContain(`ipo_intermediaries ${K}.contactPerson cleared (current reader refused: brlm_block_values_format_checked)`);
    expect(h.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'ipo_intermediaries', fieldName: 'contactPerson', rowKey: K, ruleId: 'FAILED_VALIDATION', documentId: DOC_ID })
    );
  });

  it('same document, a stated absence on the list: cleared, reason "current reader: not printed"', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc('email'));
    const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('STATED_NOT_PRINTED', TEST_ABSENCE) });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBeNull();
    expect(summary.skipped_failed_check).toContain(`ipo_intermediaries ${K}.email cleared (current reader: not printed)`);
    expect(h.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ fieldName: 'email', ruleId: 'NOT_PRINTED' }));
  });

  it('same document, a miss (brlm_blocks_unread): kept, nothing recorded', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc('email'));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('MISSED', 'brlm_blocks_unread: no_brlm_block') });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
    expect(h.recordFailure).not.toHaveBeenCalled();
  });

  it('same document, brlm_contacts absent from the output: kept', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc('email'));
    await run(h, { lead_managers: value(HELD, 1) });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
  });

  it('same document but the stored lineage records no extractor version: never cleared', async () => {
    const h = makeDeps([STORED_KOTAK], { [`ipo_intermediaries|${K}|email`]: { dataLineage: { documentId: DOC_ID, docType: 'RHP', extractorVersion: null } } });
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('REFUSED', 'x') });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
  });

  it('no keyed provenance for the stored value: a refusal keeps it', async () => {
    const h = makeDeps([STORED_KOTAK]);
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('REFUSED', 'x') });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
  });

  it('another document stored it: this document\'s refusal keeps it', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'email', { documentId: OTHER_DOC, docType: 'DRHP' }, 'DRHP'));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('REFUSED', 'x') });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
  });

  it('a lower-ranked document stored it: this document\'s stated absence clears it (RHP over DRHP)', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'email', { documentId: OTHER_DOC, docType: 'DRHP' }, 'DRHP'));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('STATED_NOT_PRINTED', TEST_ABSENCE) });
    expect(firm(h, 'BRLM', KOTAK)?.email).toBeNull();
  });

  it('a higher-ranked document stored it: this document\'s stated absence keeps it (DRHP below RHP)', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'email', { documentId: OTHER_DOC, docType: 'RHP' }));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: nullField('STATED_NOT_PRINTED', TEST_ABSENCE) }, 'DRHP');
    expect(firm(h, 'BRLM', KOTAK)?.email).toBe('old@kotak.com');
  });

  it('a DRHP value never replaces an RHP\'s stored value for the same firm column; the RHP value is kept', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'contactPerson', { documentId: OTHER_DOC, docType: 'RHP' }));
    const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([KOTAK_ROW, JM_ROW], 98) }, 'DRHP');
    expect(firm(h, 'BRLM', KOTAK)?.contactPerson).toBe('Old Person');
    // A column with no keyed provenance (unknown origin) takes the document's read.
    expect(firm(h, 'BRLM', KOTAK)?.phone).toBe('+91 22 4336 0000');
    expect(summary.skipped_lower_priority_source.some((s) => s.startsWith(`ipo_intermediaries ${K}.contactPerson`))).toBe(true);
    expect(keyedProvenance(h)).not.toContain(`${K}|contactPerson|${DOC_ID}`);
  });

  it('an RHP value replaces a DRHP\'s stored value for the same firm column', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'contactPerson', { documentId: OTHER_DOC, docType: 'DRHP' }, 'DRHP'));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([KOTAK_ROW, JM_ROW], 98) }, 'RHP');
    expect(firm(h, 'BRLM', KOTAK)?.contactPerson).toBe('Ganesh Rane');
  });

  it('an admin hold on a contact column refuses the whole replace (the admin value is kept)', async () => {
    for (const held of ['contactPerson', 'grievanceEmail']) {
      const h = makeDeps([STORED_KOTAK]);
      (h.deps as unknown as Record<string, unknown>).protectionFilter = vi.fn(
        async (_id: string, table: string, data: Record<string, unknown>) => ({
          filtered: table === 'ipo_intermediaries' ? Object.fromEntries(Object.entries(data).filter(([k]) => k !== held)) : data,
        })
      );
      const summary = await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([KOTAK_ROW, JM_ROW], 98) });
      expect(h.replaceForIpo).not.toHaveBeenCalled();
      expect(summary.skipped_protected).toContain(`ipo_intermediaries (whole-row replace refused: ${held} protected)`);
    }
  });
});

describe('filing-persister - registrar_grievance_email reaches the REGISTRAR row (item 39)', () => {
  beforeEach(() => upsertIPOMock.mockClear());
  const REG_MAIL = 'einward.ris@kfintech.com';
  const STORED_REG: Stored = { role: 'REGISTRAR', name: REG, grievanceEmail: 'old.ris@kfintech.com', email: 'nse.ipo@kfintech.com' };

  it('the document\'s registrar IS the held registrar: written with a receipt and keyed provenance', async () => {
    const h = makeDeps([]);
    const summary = await run(h, { registrar_name: value(REG, 2), registrar_grievance_email: value(REG_MAIL, 101) });
    expect(firm(h, 'REGISTRAR', REG)?.grievanceEmail).toBe(REG_MAIL);
    expect(intermediaryReceipts(summary)).toContain(`${RK}|grievanceEmail|${REG_MAIL}`);
    expect(keyedProvenance(h)).toContain(`${RK}|grievanceEmail|${DOC_ID}`);
  });

  it('the document names another registrar: nothing written on the held registrar, stored value kept, no receipt', async () => {
    const h = makeDeps([STORED_REG]);
    const summary = await run(h, { registrar_name: value('Link Intime India Private Limited', 2), registrar_grievance_email: value(REG_MAIL, 101) });
    expect(firm(h, 'REGISTRAR', REG)?.grievanceEmail).toBe('old.ris@kfintech.com');
    expect(intermediaryReceipts(summary).filter((x) => x.includes('grievanceEmail'))).toEqual([]);
  });

  it('no registrar read in this document: the stored grievance e-mail is kept', async () => {
    const h = makeDeps([STORED_REG]);
    await run(h, { registrar_grievance_email: value(REG_MAIL, 101) });
    expect(firm(h, 'REGISTRAR', REG)?.grievanceEmail).toBe('old.ris@kfintech.com');
  });

  it('same document, the reader refused it: cleared; a miss: kept', async () => {
    const prov = origin(RK, 'grievanceEmail', { documentId: DOC_ID, docType: 'RHP' });
    const refused = makeDeps([STORED_REG], prov);
    await run(refused, { registrar_name: value(REG, 2), registrar_grievance_email: nullField('REFUSED', 'email_form') });
    expect(firm(refused, 'REGISTRAR', REG)?.grievanceEmail).toBeNull();
    const missed = makeDeps([STORED_REG], prov);
    await run(missed, { registrar_name: value(REG, 2), registrar_grievance_email: nullField('MISSED', 'registrar_grievance_email_unread: no_registrar_block') });
    expect(firm(missed, 'REGISTRAR', REG)?.grievanceEmail).toBe('old.ris@kfintech.com');
  });

  it('the registrar\'s other columns keep today\'s behaviour (registrar contact lines unchanged)', async () => {
    const h = makeDeps([STORED_REG]);
    await run(h, { registrar_name: value(REG, 2), registrar_grievance_email: value(REG_MAIL, 101) });
    expect(firm(h, 'REGISTRAR', REG)?.email).toBe('nse.ipo@kfintech.com');
  });
});

describe('filing-persister - review round 1: every producer must clear; per-column reasons; formats; F-248', () => {
  beforeEach(() => upsertIPOMock.mockClear());
  const sameDoc = (rk: string, field: string) => origin(rk, field, { documentId: DOC_ID, docType: 'RHP' });

  it('row 158 misses + brlm_contacts refused: the stored grievance e-mail is kept', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc(K, 'grievanceEmail'));
    await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: nullField('REFUSED', 'x'),
      brlm_grievance_emails: nullField('MISSED', 'brlm_grievance_emails_unread: no_grievance_label'),
    });
    expect(firm(h, 'BRLM', KOTAK)?.grievanceEmail).toBe('old-redressal@kotak.com');
  });

  it('row 158 produced a value for another firm only + brlm_contacts refused: kept (a VALUE with no entry is a miss)', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc(K, 'grievanceEmail'));
    await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: nullField('REFUSED', 'x'),
      brlm_grievance_emails: value({ [JM]: 'grievance.ibd@jmfl.com' }, 98),
    });
    expect(firm(h, 'BRLM', KOTAK)?.grievanceEmail).toBe('old-redressal@kotak.com');
  });

  it('both producers refuse: the grievance e-mail is cleared and the reason names both', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc(K, 'grievanceEmail'));
    const summary = await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: nullField('REFUSED', 'a'),
      brlm_grievance_emails: nullField('REFUSED', 'b'),
    });
    expect(firm(h, 'BRLM', KOTAK)?.grievanceEmail).toBeNull();
    expect(summary.skipped_failed_check.some((x) => x.startsWith(`ipo_intermediaries ${K}.grievanceEmail cleared`) && x.includes('brlm_contacts: a') && x.includes('brlm_grievance_emails: b'))).toBe(true);
  });

  it('sole BRLM: brlm_contacts refused but lead_manager_sebi_reg produced a value: the SEBI no. is the value, never cleared', async () => {
    const h = makeDeps([{ role: 'BRLM', name: KOTAK, sebiRegNo: 'INM000000001' }], sameDoc(K, 'sebiRegNo'));
    (h.deps.ipoRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: IPO_ID, companyName: 'X Limited', slug: 'x-ltd', segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING',
      listingExchanges: [], leadManagers: [KOTAK], registrar: REG,
    });
    await run(h, { lead_managers: value([KOTAK], 1), brlm_contacts: nullField('REFUSED', 'x'), lead_manager_sebi_reg: value('INM000008704', 98) });
    expect(firm(h, 'BRLM', KOTAK)?.sebiRegNo).toBe('INM000008704');
  });

  it('per-column reasons: a refusal reason clears that column (same document); label_not_found or no reason keeps', async () => {
    const h = makeDeps([STORED_KOTAK], { ...sameDoc(K, 'phone'), ...sameDoc(K, 'email'), ...sameDoc(K, 'contactPerson') });
    const summary = await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: value([
        { ...KOTAK_ROW, phone: null, email: null, contact_person: null, reasons: { phone: 'phone_format', email: 'label_not_found' } },
        JM_ROW,
      ], 98),
    });
    expect(firm(h, 'BRLM', KOTAK)).toMatchObject({ phone: null, email: 'old@kotak.com', contactPerson: 'Old Person' });
    expect(summary.skipped_failed_check).toContain(`ipo_intermediaries ${K}.phone cleared (current reader refused: phone_format)`);
  });

  it('per-column stated absence on the list clears from a lower-ranked document', async () => {
    const h = makeDeps([STORED_KOTAK], origin(K, 'phone', { documentId: OTHER_DOC, docType: 'DRHP' }, 'DRHP'));
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([{ ...KOTAK_ROW, phone: null, reasons: { phone: TEST_ABSENCE } }, JM_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)?.phone).toBeNull();
  });

  it('formats: a malformed phone and a firm name as contact person are not written (stored kept); " / " names are', async () => {
    const h = makeDeps([STORED_KOTAK], { ...sameDoc(K, 'phone'), ...sameDoc(K, 'contactPerson') });
    await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: value([
        { ...KOTAK_ROW, phone: '+91 0124473980', contact_person: 'Kotak Securities Limited' },
        { ...JM_ROW, contact_person: 'Prachee Dhuri / A. K. Shah', phone: '+91 22 6630 3030 / 1800 102 1234' },
      ], 98),
    });
    expect(firm(h, 'BRLM', KOTAK)).toMatchObject({ phone: '+91 22 1111 1111', contactPerson: 'Old Person' });
    expect(firm(h, 'BRLM', JM)).toMatchObject({ contactPerson: 'Prachee Dhuri / A. K. Shah', phone: '+91 22 6630 3030 / 1800 102 1234' });
  });

  it('a SEBI number printed with an "MB/" prefix is dropped (spec row 154 defines no stored form)', async () => {
    const h = makeDeps([]);
    await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([{ ...KOTAK_ROW, sebi_reg_no: 'MB/INM000008704' }, JM_ROW], 98) });
    expect(firm(h, 'BRLM', KOTAK)?.sebiRegNo).toBeNull();
  });

  it('F-248: brlm_contacts and row 158 disagree on a grievance e-mail: refused, logged, stored kept, no receipt', async () => {
    const h = makeDeps([STORED_KOTAK], sameDoc(K, 'grievanceEmail'));
    const summary = await run(h, {
      lead_managers: value(HELD, 1),
      brlm_contacts: value([KOTAK_ROW, JM_ROW], 98),
      brlm_grievance_emails: value({ [KOTAK]: 'other@kotak.com', [JM]: 'grievance.ibd@jmfl.com' }, 98),
    });
    expect(firm(h, 'BRLM', KOTAK)?.grievanceEmail).toBe('old-redressal@kotak.com');
    expect(firm(h, 'BRLM', JM)?.grievanceEmail).toBe('grievance.ibd@jmfl.com');
    expect(summary.skipped_failed_check.some((x) => x.startsWith(`ipo_intermediaries ${K}.grievanceEmail (copies_disagree`))).toBe(true);
    expect(intermediaryReceipts(summary).filter((x) => x.startsWith(`${K}|grievanceEmail`))).toEqual([]);
  });
});

describe('filing-persister - the revised reader\'s per-field codes (e234236ca)', () => {
  beforeEach(() => upsertIPOMock.mockClear());
  const sameDoc = (rk: string, field: string) => origin(rk, field, { documentId: DOC_ID, docType: 'RHP' });
  const CODES = [
    ['phone', 'phone', 'phone_format'],
    ['sebiRegNo', 'sebi_reg_no', 'sebi_format'],
    ['email', 'email', 'not_one_email'],
    ['contactPerson', 'contact_person', 'person_format'],
    ['contactPerson', 'contact_person', 'contact_split_unsure'],
    ['phone', 'phone', 'two_values_in_block'],
    ['email', 'email', 'column_overrun'],
    ['contactPerson', 'contact_person', 'page_break_unattributed'],
    ['phone', 'phone', 'duplicate_firm_blocks'],
  ] as const;

  for (const [col, field, code] of CODES) {
    it(`${code} on ${field} clears a value this same document stored`, async () => {
      const h = makeDeps([STORED_KOTAK], sameDoc(K, col));
      const summary = await run(h, {
        lead_managers: value(HELD, 1),
        brlm_contacts: value([{ ...KOTAK_ROW, [field]: null, reasons: { [field]: code } }, JM_ROW], 98),
      });
      expect(firm(h, 'BRLM', KOTAK)?.[col]).toBeNull();
      expect(summary.skipped_failed_check).toContain(`ipo_intermediaries ${K}.${col} cleared (current reader refused: ${code})`);
    });
  }

  for (const miss of ['label_without_value', 'label_not_found', 'some_future_code']) {
    it(`${miss} keeps the stored value`, async () => {
      const h = makeDeps([STORED_KOTAK], sameDoc(K, 'phone'));
      await run(h, { lead_managers: value(HELD, 1), brlm_contacts: value([{ ...KOTAK_ROW, phone: null, reasons: { phone: miss } }, JM_ROW], 98) });
      expect(firm(h, 'BRLM', KOTAK)?.phone).toBe('+91 22 1111 1111');
    });
  }

  it('registrar_grievance_email REFUSED (emit.refuse, copies_disagree in check.detail) clears; MISSED (label_not_found / registrar_block_not_found) keeps', async () => {
    const REG_STORED: Stored = { role: 'REGISTRAR', name: REG, grievanceEmail: 'old.ris@kfintech.com' };
    const prov = origin(RK, 'grievanceEmail', { documentId: DOC_ID, docType: 'RHP' });
    const refusedField = ({ value: null, page: null, check: { name: 'email_form', passed: false, detail: 'copies_disagree' }, state: 'REFUSED' }) as unknown as Field;
    const refused = makeDeps([REG_STORED], prov);
    const summary = await run(refused, { registrar_name: value(REG, 2), registrar_grievance_email: refusedField });
    expect(firm(refused, 'REGISTRAR', REG)?.grievanceEmail).toBeNull();
    expect(summary.skipped_failed_check).toContain(`ipo_intermediaries ${RK}.grievanceEmail cleared (current reader refused: copies_disagree)`);
    for (const why of ['label_not_found', 'registrar_block_not_found']) {
      const missed = makeDeps([REG_STORED], prov);
      await run(missed, { registrar_name: value(REG, 2), registrar_grievance_email: nullField('MISSED', why) });
      expect(firm(missed, 'REGISTRAR', REG)?.grievanceEmail).toBe('old.ris@kfintech.com');
    }
  });
});
