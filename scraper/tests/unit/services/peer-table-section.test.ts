/**
 * Item 8a slice 1 — the locator, tested against the four real RHPs and the one
 * table that is designed to fool it.
 *
 * Every case here runs on committed fixture text extracted from a real
 * prospectus, not on a heading typed from memory. That distinction is the whole
 * reason this item has a fixtures slice: I got the heading wording wrong twice
 * from memory before reading the documents, and a third time while writing this
 * file's own source comment.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPeerTableSection,
  containsKpiComparisonTable,
} from '../../../src/services/peer-table-section.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', 'fixtures', 'peer-tables');
const fixture = (name: string): string => readFileSync(path.join(FIXTURES, name), 'utf8');

interface Case {
  file: string;
  marker: string;
  headingContains: string;
  /** A peer that must appear in the section body, proving the body is the table. */
  peerInBody: string;
}

const CASES: Case[] = [
  {
    file: 'karamtara-peer-table.txt',
    marker: '6',
    headingContains: 'Comparison of Accounting Ratios with Listed Industry Peers',
    peerInBody: 'Inox Wind',
  },
  {
    file: 'prasolchem-peer-table.txt',
    marker: '6',
    headingContains: 'Comparison of Accounting Ratios with Listed Industry Peers',
    peerInBody: 'Aarti Industries',
  },
  {
    file: 'kanohar-peer-table.txt',
    marker: '8',
    headingContains: 'key accounting ratios',
    peerInBody: 'Hitachi Energy',
  },
  {
    file: 'glasswall-peer-table.txt',
    marker: 'VI',
    headingContains: 'accounting ratios with listed industry peers',
    peerInBody: 'Innovator',
  },
];

describe('findPeerTableSection, on the four real prospectuses', () => {
  it.each(CASES.map((c) => [c.file, c] as const))('%s: finds the section', (_n, c) => {
    const found = findPeerTableSection(fixture(c.file));
    expect(found, 'no section found').not.toBeNull();
    expect(found!.heading).toContain(c.headingContains);
    expect(found!.sectionMarker).toBe(c.marker);
  });

  it.each(CASES.map((c) => [c.file, c] as const))(
    '%s: the body is the table, not just the heading',
    (_n, c) => {
      // A locator that returned the heading and an empty body would satisfy
      // every other case here. Naming a peer that must be inside the body is
      // what stops that from passing.
      //
      // Whitespace is COLLAPSED first, and that is not cosmetic: a PDF text
      // layer wraps a peer's name across lines, so PRASOLCHEM's body contains
      // "Aarti" and "Industries" on separate lines with trailing spaces. A
      // naive join produces "Aarti  Industries" and the assertion fails on a
      // correct result. Every matcher over this text has to collapse runs of
      // whitespace or it is testing the PDF's line breaks, not the content.
      const found = findPeerTableSection(fixture(c.file));
      const body = found!.body.join(' ').replace(/\s+/g, ' ');
      expect(body).toContain(c.peerInBody);
    }
  );

  it('Glasswall: the heading is NOT the cross-reference twelve lines above it', () => {
    // The trap that corrected the card. Glasswall's notes say "...based on the
    // peer set provided below under 'Comparison with listed industry peers'".
    // That is a mention inside a sentence. The real heading is
    // "VI. Comparison of accounting ratios with listed industry peers".
    const text = fixture('glasswall-peer-table.txt');
    const found = findPeerTableSection(text)!;
    const lines = text.split(/\r?\n/);

    const crossRefLine = lines.findIndex((l) => /provided below under/i.test(l));
    expect(crossRefLine, 'fixture no longer contains the cross-reference').toBeGreaterThan(-1);
    expect(found.headingLine).toBeGreaterThan(crossRefLine);
    expect(found.heading).not.toMatch(/provided below under/i);
    expect(found.sectionMarker).toBe('VI');
  });
});

describe('the KPI table is refused, not merely unmatched', () => {
  it('the negative fixture yields no peer-table section', () => {
    expect(findPeerTableSection(fixture('kanohar-kpi-table-NEGATIVE.txt'))).toBeNull();
  });

  it('and it is recognisable AS the KPI table, so a caller can say which it was', () => {
    // "found nothing" and "found the wrong table and declined it" are different
    // outcomes; only one of them is worth alerting on.
    expect(containsKpiComparisonTable(fixture('kanohar-kpi-table-NEGATIVE.txt'))).toBe(true);
  });

  it('the real peer tables are NOT mistaken for the KPI table', () => {
    for (const c of CASES) {
      expect(containsKpiComparisonTable(fixture(c.file)), c.file).toBe(false);
    }
  });

  it('a KPI heading that DOES use the peer-table wording is still refused', () => {
    // This case exists because mutation testing caught the explicit KPI guard
    // in findPeerTableSection doing nothing. Kanohar's real KPI heading reads
    // "Comparison of KPIs with our peers listed in India" — which already fails
    // the heading phrase, since that requires "listed industry peers". So
    // deleting the KPI guard changed no result, and the guard read as a safety
    // check while being unreachable. Dead code that looks load-bearing is worse
    // than no code: the next reader trusts it.
    //
    // It is kept rather than deleted because this wording is a plausible
    // variant we have not yet met — and this case is what makes it reachable,
    // so removing the guard now turns the suite red instead of silently
    // widening what gets parsed as a peer table.
    const synthetic = [
      '7. Comparison of KPIs with listed industry peers',
      'Name of Company Revenue EBITDA',
      'Listed Peers',
      'Some Rival Limited 100 20',
    ].join('\n');
    expect(findPeerTableSection(synthetic)).toBeNull();
  });
});

describe('shapes that must not match', () => {
  it('a prose mention inside a sentence is not a heading', () => {
    const text = [
      'a) The highest and lowest industry P/E shown above is based on the peer set',
      '   provided below under "Comparison with listed industry peers". The industry',
      '   average has been calculated as the arithmetic average P/E of the peer set.',
    ].join('\n');
    expect(findPeerTableSection(text)).toBeNull();
  });

  it('a numbered NOTE does not end the section early', () => {
    // "1. Figures for listed peers have been provided by our Company." carries a
    // section-marker shape. Treating any marker as the next heading would cut
    // the table off at its first note and lose every row after it.
    const text = [
      '6. Comparison of Accounting Ratios with Listed Industry Peers',
      'Name of Company Face Value',
      'Listed Peers',
      'Inox Wind Limited 10.00',
      '1. Figures for listed peers have been provided by our Company and verified.',
      'Waaree Energies Limited 10.00',
      'Notes:',
      '2. This line is past the terminator and must not appear.',
    ].join('\n');
    const found = findPeerTableSection(text)!;
    const body = found.body.join(' ');
    expect(body).toContain('Waaree Energies');
    expect(body).not.toContain('past the terminator');
  });

  it('text with no such section returns null rather than guessing', () => {
    expect(findPeerTableSection('3. INDUSTRY PEER GROUP P/E RATIO\nHighest 206.68')).toBeNull();
  });

  it('an empty document does not throw', () => {
    expect(findPeerTableSection('')).toBeNull();
  });
});
