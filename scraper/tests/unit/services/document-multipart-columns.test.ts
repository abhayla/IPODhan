/**
 * Item 22 slice 4 — the two columns a multi-part filing needs.
 *
 * NSE and BSE sometimes publish one filing as several PDFs ("Part 1 of 3"), and
 * every exchange gives a filing its own stable id. Today we store neither, so
 * two things are impossible:
 *
 *   - citing "page 118 of part 2" — a citation that names a page without naming
 *     the part points at the wrong page in a three-part RHP
 *   - recognising the SAME filing served twice under different URLs, which the
 *     sha256 dedup only catches when the bytes are byte-identical
 *
 * Both columns are NULLABLE on purpose and the tests below pin that. A single-
 * part document has no part number, and `1` would be a lie that reads as truth:
 * every existing row would claim to be part one of something.
 */

import { describe, it, expect } from 'vitest';
import { documents } from '@ipodhan/shared/db/schema';
import { getTableConfig } from 'drizzle-orm/pg-core';

const cols = Object.fromEntries(getTableConfig(documents).columns.map((c) => [c.name, c]));

describe('documents gains part_number and exchange_document_id', () => {
  it('the table was read at all - a zero-column read cannot fail', () => {
    expect(Object.keys(cols).length).toBeGreaterThan(10);
  });

  it('part_number exists', () => {
    expect(cols.part_number).toBeDefined();
  });

  it('part_number is NULLABLE - a single-part document has no part number', () => {
    // `1` as a default would make every pre-existing row claim to be part one of
    // a multi-part filing. NULL is the honest value for "this is the whole thing".
    expect(cols.part_number.notNull).toBe(false);
  });

  it('part_number has NO default, so nothing invents one', () => {
    expect(cols.part_number.hasDefault).toBe(false);
  });

  it('part_number is an integer, not text - it is ordered, and parts sort', () => {
    expect(cols.part_number.getSQLType()).toMatch(/^integer$/);
  });

  it('exchange_document_id exists and is nullable', () => {
    expect(cols.exchange_document_id).toBeDefined();
    expect(cols.exchange_document_id.notNull).toBe(false);
  });

  it('exchange_document_id is NOT unique on its own', () => {
    // Two exchanges can hand out the same id string for different filings, and
    // one filing arrives in several parts under one id. A unique constraint here
    // would reject legitimate rows; identity is (exchange, id, part), which is
    // a later slice's problem and deliberately not asserted here.
    const uniques = getTableConfig(documents).uniqueConstraints ?? [];
    const offending = uniques.filter(
      (u) => u.columns.length === 1 && u.columns[0].name === 'exchange_document_id'
    );
    expect(offending).toEqual([]);
  });

  it('neither column is NOT NULL - an additive migration must be safe on 258 existing rows', () => {
    // The staging table already holds 258 documents. A NOT NULL column with no
    // default fails outright on a non-empty table; one with a default silently
    // fills every historical row with a value nobody measured.
    expect(cols.part_number.notNull).toBe(false);
    expect(cols.exchange_document_id.notNull).toBe(false);
  });

  it('sequence_number is untouched - it means something else and is still NOT NULL', () => {
    // sequence_number distinguishes an addendum from the original; part_number
    // splits ONE document across files. Conflating them is the obvious mistake
    // and this pins that it was not made.
    expect(cols.sequence_number).toBeDefined();
    expect(cols.sequence_number.notNull).toBe(true);
  });
});
