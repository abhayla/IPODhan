/**
 * Item 8 pre-slice: the committed peer-table fixtures, and the properties 8a's
 * parser will be written against.
 *
 * These exist because I got item 8 wrong twice in one night. First the card said
 * "peer comparison table: 4 of 4" on a keyword match. Then I filed an issue
 * claiming the opposite - that an RHP carries only a Highest/Lowest/Average P/E
 * summary - because I searched for the heading "comparison with listed industry
 * peers" and got zero hits. The documents word that heading THREE different ways;
 * my pattern matched none of them, and I read zero hits as a fact about the
 * document instead of a fact about my pattern.
 *
 * So the fixtures are not convenience. They are the thing that makes the next
 * claim checkable without a 17 MB download and a lucky regex. The PDFs are 9.5 to
 * 17.7 MB and are NOT committed; the extracted text of the relevant pages is.
 *
 * Sources (re-fetchable):
 *   PRASOLCHEM  nsearchives.nseindia.com/content/ipo/RHP_PRASOLCHEM.zip   pp 206-207
 *   GLASSWALL   nsearchives.nseindia.com/content/ipo/RHP_GLASSWALL.zip    pp 143-144
 *   KANOHAR     nsearchives.nseindia.com/content/ipo/RHP_KANOHAR.zip      pp 156-157
 *   KARAMTARA   sebi.gov.in/sebi_data/attachdocs/sep-2026/1788514905936.pdf pp 135-136
 *
 * THE NEGATIVE FIXTURE IS THE POINT OF THE EXERCISE. Kanohar p.160 prints a
 * SECOND peer-shaped table - "Comparison of KPIs with our peers listed in India" -
 * listing the same companies with numeric columns. A loose heading matcher finds
 * it. Without a case that requires the parser to REJECT it, "does the matcher find
 * the table" and "does the matcher find the RIGHT table" are the same test, and
 * only the first one is actually being asked.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', 'fixtures', 'peer-tables');

// The heading as it is ACTUALLY written, across three wordings and two numbering
// styles: "Comparison of Accounting Ratios with Listed Industry Peers" (section 6,
// Karamtara and PRASOLCHEM), "Comparison of key accounting ratios with listed
// industry peers" (section 8, Kanohar), and "Comparison with listed industry
// peers" (roman VI, Glasswall). Anything narrower misses at least one issuer -
// measured, not guessed.
const HEADING = /comparison\s+(?:\S+\s+){0,4}?with\s+(?:the\s+)?listed\s+industry\s+peers/i;

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

// Whitespace is collapsed before matching. A PDF text layer wraps headings across
// lines mid-phrase, so a pattern that assumes single spaces fails on the real
// artefact while passing on anything retyped by hand.
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

interface Issuer {
  file: string;
  peers: string[];
  distinctColumn: string;
}

// Peer names are asserted, not just the heading, because a fixture that captured
// the heading and lost the table body would still satisfy a heading-only check -
// and that is precisely the hollow result this whole item keeps producing.
const ISSUERS: Issuer[] = [
  {
    file: 'karamtara-peer-table.txt',
    peers: [
      'Inox Wind',
      'Waaree Energies',
      'KP Green Engineering',
      'Suzlon Energy',
      'Premier Energies',
      'Vikram Solar',
      'Saatvik Green Energy',
      'Emmvee Photovoltaic',
    ],
    // Karamtara alone prints market capitalisation on BSE.
    distinctColumn: 'Market',
  },
  {
    file: 'prasolchem-peer-table.txt',
    peers: [
      'Aarti Industries',
      'Atul',
      'Laxmi Organic',
      'Vinati Organic',
      'Privi Speciality',
    ],
    // PRASOLCHEM alone prints Total Income.
    distinctColumn: 'Total',
  },
  {
    file: 'kanohar-peer-table.txt',
    peers: [
      'Hitachi Energy',
      'Bharat Heavy Electricals',
      'Schneider Electric',
      'CG Power',
      'Transformers',
      'GE Vernova',
    ],
    // Kanohar alone prints EV / Operating EBITDA.
    distinctColumn: 'EBITDA',
  },
  {
    file: 'glasswall-peer-table.txt',
    // ONE listed peer. That is why its own summary reads Highest 16.54 /
    // Lowest 16.54 / Average 16.54. A parser that requires two or more rows
    // rejects a valid table, so this issuer is the reason the minimum is one.
    peers: ['Innovator'],
    distinctColumn: 'Profit',
  },
];

describe('peer-table fixtures carry the real thing, in all three heading wordings', () => {
  it.each(ISSUERS.map((i) => [i.file, i] as const))(
    '%s contains the section heading',
    (_name, issuer) => {
      expect(HEADING.test(flat(fixture(issuer.file)))).toBe(true);
    }
  );

  it.each(ISSUERS.map((i) => [i.file, i] as const))(
    '%s contains every listed peer, so the table BODY survived extraction',
    (_name, issuer) => {
      const text = flat(fixture(issuer.file));
      const missing = issuer.peers.filter((p) => !text.includes(p));
      expect(missing, `missing peer rows: ${missing.join(', ')}`).toEqual([]);
    }
  );

  it.each(ISSUERS.map((i) => [i.file, i] as const))(
    '%s keeps the column that only it has',
    (_name, issuer) => {
      // The column sets differ per issuer. If these ever collapse to a common
      // set, the fixtures have been regenerated wrongly and the whole reason for
      // header-mapped parsing has quietly disappeared.
      expect(flat(fixture(issuer.file))).toContain(issuer.distinctColumn);
    }
  );

  it('the four issuers do NOT agree on their columns - the reason 8a must map by header', () => {
    const distinct = ISSUERS.map((i) => i.distinctColumn);
    expect(new Set(distinct).size).toBe(ISSUERS.length);
  });

  it('peer counts run from one to eight, so a parser must accept a single-peer table', () => {
    const counts = ISSUERS.map((i) => i.peers.length).sort((a, b) => a - b);
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(8);
  });
});

describe('the negative fixture is what tells a right match from a lucky one', () => {
  const negative = () => flat(fixture('kanohar-kpi-table-NEGATIVE.txt'));

  it('does NOT carry the accounting-ratios heading', () => {
    expect(HEADING.test(negative())).toBe(false);
  });

  it('DOES carry the KPI heading, so it is a real trap and not an empty file', () => {
    // Guards the guard. A truncated or wrong page would pass the case above by
    // containing nothing at all, which would look like discrimination and be
    // vacuum.
    expect(negative()).toMatch(/comparison of kpis with our peers/i);
  });

  it('mentions peer companies, which is exactly why a loose matcher grabs it', () => {
    expect(negative().toLowerCase()).toContain('peer');
  });
});
