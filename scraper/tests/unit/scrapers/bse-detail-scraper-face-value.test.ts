/**
 * W-02 round 2: bse-detail-scraper.ts previously defaulted a missing "Face
 * Value" field to 10 (`faceValueStr ? ... : 10`). A missing face value must
 * stay undefined, never be fabricated as 10.
 */

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import { parseACQDispPage, parseDisplayIPOPage } from '../../../src/scrapers/bse-detail-scraper.js';

describe('bse-detail-scraper faceValue (W-02 round 2 fix)', () => {
  it('parseACQDispPage: leaves faceValue undefined when the page has no Face Value row', () => {
    const $ = cheerio.load('<html><body><table></table></body></html>');
    const result = parseACQDispPage($);
    expect(result.faceValue).toBeUndefined();
  });

  it('parseDisplayIPOPage: leaves faceValue undefined when the page has no Face Value row', () => {
    const $ = cheerio.load('<html><body><table></table></body></html>');
    const result = parseDisplayIPOPage($);
    expect(result.faceValue).toBeUndefined();
  });

  it('parseACQDispPage: still parses a genuine Face Value from the mainboard fixture', () => {
    const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures');
    const html = fs.readFileSync(path.join(fixturesPath, 'bse-mainboard-acqdisp.html'), 'utf-8');
    const $ = cheerio.load(html);
    const result = parseACQDispPage($);
    expect(result.faceValue).toBe(10);
  });
});
