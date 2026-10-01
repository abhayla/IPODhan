// #1442 round 2: what each HTTP answer means to the repair tool. RETIRE only on proof of a dead link
// (HTTP 404 / 410); anything transient changes nothing and says why.
import { describe, it, expect } from 'vitest';
import { classifyFetchAnswer, makeLiveFetch, isUniqueDocPerIpoViolation } from '../../../scripts/repair-chittorgarh-default-prospectus';
import { resolveProspectusRowType, type ChittorgarhProspectusRow } from '../../../src/scrapers/chittorgarh-document-scraper';

const ROW: ChittorgarhProspectusRow = {
  companyName: 'x', slug: 'x', isin: null, bseScripCode: null, nseSymbol: null, exchange: null, issueType: null, openDate: null,
  pdfUrl: 'https://files.test.invalid/a.pdf', docType: null,
};
const PDF = Buffer.from('%PDF-1.7 body');
const HTML = Buffer.from('<html><title>Just a moment...</title></html>');
const resp = (status: number, body: Buffer = Buffer.alloc(0)) => async () => new Response(body, { status });

async function resolve(fetchImpl: typeof fetch) {
  const live = makeLiveFetch(1000, fetchImpl);
  const res = await resolveProspectusRowType(ROW, {
    fetchPdf: live.fetchPdf,
    coverText: async () => ({ usable: true, text: 'RED HERRING PROSPECTUS', alnum: 22 }),
  });
  return { res, note: live.fetchNote(ROW.pdfUrl) };
}

describe('fetch outcome classification', () => {
  it.each([[404], [410]])('HTTP %i -> dead link -> RETIRE (resolver says not_pdf)', async (st) => {
    expect(classifyFetchAnswer(st, null).kind).toBe('dead_link');
    expect((await resolve(resp(st) as never)).res).toEqual({ ok: false, reason: 'not_pdf' });
  });
  it('HTTP 200 PDF -> read on', async () => {
    expect(classifyFetchAnswer(200, PDF).kind).toBe('pdf');
    expect((await resolve(resp(200, PDF) as never)).res.ok).toBe(true);
  });
  it('HTTP 200 HTML (challenge page) -> NO change, reason recorded', async () => {
    expect(classifyFetchAnswer(200, HTML).kind).toBe('not_changed');
    const r = await resolve(resp(200, HTML) as never);
    expect(r.res).toEqual({ ok: false, reason: 'fetch_failed' });
    expect(r.note).toMatch(/not a PDF/);
  });
  it.each([[500], [502], [503], [403], [429], [301]])('HTTP %i -> NO change, reason recorded', async (st) => {
    expect(classifyFetchAnswer(st, null).kind).toBe('not_changed');
    const r = await resolve(resp(st) as never);
    expect(r.res).toEqual({ ok: false, reason: 'fetch_failed' });
    expect(r.note).toBe(`HTTP ${st}`);
  });
  it('timeout -> NO change, reason "timeout"', async () => {
    const r = await resolve((async () => { throw new DOMException('timed out', 'TimeoutError'); }) as never);
    expect(r.res).toEqual({ ok: false, reason: 'fetch_failed' });
    expect(r.note).toBe('timeout');
  });
  it('network error -> NO change, reason recorded', async () => {
    const r = await resolve((async () => { throw new Error('ECONNRESET'); }) as never);
    expect(r.res).toEqual({ ok: false, reason: 'fetch_failed' });
    expect(r.note).toMatch(/network error: ECONNRESET/);
  });
  it('sends the same browser User-Agent the backfill sends', async () => {
    let ua: string | undefined;
    await resolve((async (_u: string, init: RequestInit) => { ua = (init.headers as Record<string, string>)['User-Agent']; return new Response(PDF, { status: 200 }); }) as never);
    expect(ua).toBe('Mozilla/5.0');
  });
});

describe('unique_doc_per_ipo detection', () => {
  it('matches a wrapped pg error and ignores others', () => {
    expect(isUniqueDocPerIpoViolation({ message: 'Failed query', cause: { code: '23505', constraint: 'unique_doc_per_ipo' } })).toBe(true);
    expect(isUniqueDocPerIpoViolation({ code: '23505', constraint: 'documents_pkey' })).toBe(false);
    expect(isUniqueDocPerIpoViolation(new Error('row changed since it was read'))).toBe(false);
  });
});
