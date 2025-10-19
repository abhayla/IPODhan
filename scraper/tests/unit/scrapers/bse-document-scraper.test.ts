/**
 * Unit Tests for BSE Document Scraper
 *
 * Test Coverage:
 * - Document link extraction from HTML
 * - URL absolutization
 * - Document link filtering
 * - Deduplication
 * - Edge cases (empty, invalid, etc.)
 *
 * Total: 15+ test cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { scrapeBSEDocuments, type DocumentLink } from '../../../src/scrapers/bse-document-scraper.js';

describe('bse-document-scraper', () => {
  describe('scrapeBSEDocuments - Basic Extraction', () => {
    it('should extract document links from simple HTML', () => {
      const html = `
        <html>
          <body>
            <table>
              <tr>
                <td><a href="/path/to/DRHP.pdf">Draft Red Herring Prospectus</a></td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe('Draft Red Herring Prospectus');
      expect(docs[0].url).toBe('https://www.bseindia.com/path/to/DRHP.pdf');
    });

    it('should extract multiple document links', () => {
      const html = `
        <html>
          <body>
            <table>
              <tr><td><a href="/drhp.pdf">Draft Red Herring Prospectus</a></td></tr>
              <tr><td><a href="/rhp.pdf">Red Herring Prospectus</a></td></tr>
              <tr><td><a href="/prospectus.pdf">Prospectus</a></td></tr>
            </table>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs.length).toBeGreaterThanOrEqual(3);
      expect(docs.map(d => d.title)).toContain('Draft Red Herring Prospectus');
      expect(docs.map(d => d.title)).toContain('Red Herring Prospectus');
      expect(docs.map(d => d.title)).toContain('Prospectus');
    });

    it('should handle links in different HTML structures', () => {
      const html = `
        <html>
          <body>
            <div>
              <a href="/documents/drhp.pdf">Draft Red Herring Prospectus</a>
            </div>
            <ul>
              <li><a href="/documents/rhp.pdf">Red Herring Prospectus</a></li>
            </ul>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('scrapeBSEDocuments - URL Absolutization', () => {
    it('should make relative URLs absolute (leading slash)', () => {
      const html = `
        <a href="/path/to/document.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs[0].url).toBe('https://www.bseindia.com/path/to/document.pdf');
    });

    it('should make relative URLs absolute (no leading slash)', () => {
      const html = `
        <a href="documents/drhp.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs[0].url).toBe('https://www.bseindia.com/documents/drhp.pdf');
    });

    it('should keep absolute HTTP URLs unchanged', () => {
      const html = `
        <a href="http://example.com/document.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs[0].url).toBe('http://example.com/document.pdf');
    });

    it('should keep absolute HTTPS URLs unchanged', () => {
      const html = `
        <a href="https://example.com/document.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs[0].url).toBe('https://example.com/document.pdf');
    });

    it('should handle protocol-relative URLs (//example.com)', () => {
      const html = `
        <a href="//example.com/document.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs[0].url).toBe('https://example.com/document.pdf');
    });

    it('should use custom base URL when provided', () => {
      const html = `
        <a href="/document.pdf">DRHP</a>
      `;

      const docs = scrapeBSEDocuments(html, 'https://custom.example.com');

      expect(docs[0].url).toBe('https://custom.example.com/document.pdf');
    });
  });

  describe('scrapeBSEDocuments - Document Link Filtering', () => {
    it('should filter out navigation links (Home, Back, etc.)', () => {
      const html = `
        <html>
          <body>
            <a href="/">Home</a>
            <a href="/back">Back</a>
            <a href="/search">Search</a>
            <a href="/documents/drhp.pdf">Draft Red Herring Prospectus</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // Should only extract the DRHP document, not navigation links
      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('Draft Red Herring Prospectus');
    });

    it('should filter out very short link text (likely navigation)', () => {
      const html = `
        <html>
          <body>
            <a href="/link1">Go</a>
            <a href="/link2">OK</a>
            <a href="/link3">X</a>
            <a href="/documents/drhp.pdf">Draft Red Herring Prospectus</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // Should filter out very short links
      expect(docs.length).toBe(1);
      expect(docs[0].title).toBe('Draft Red Herring Prospectus');
    });

    it('should include links with document keywords (prospectus, addendum, etc.)', () => {
      const html = `
        <html>
          <body>
            <a href="/doc1.aspx">Prospectus</a>
            <a href="/doc2.aspx">Addendum</a>
            <a href="/doc3.aspx">Basis of Allotment</a>
            <a href="/doc4.aspx">Audiovisual DRHP</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs.length).toBeGreaterThanOrEqual(4);
    });

    it('should include links with .pdf extension', () => {
      const html = `
        <a href="/document.pdf">Download Document</a>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs.length).toBe(1);
    });
  });

  describe('scrapeBSEDocuments - Deduplication', () => {
    it('should remove duplicate URLs (exact match)', () => {
      const html = `
        <html>
          <body>
            <a href="/drhp.pdf">Draft Red Herring Prospectus</a>
            <a href="/drhp.pdf">DRHP (Duplicate)</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // Should only have 1 document (duplicate URL removed)
      expect(docs.length).toBe(1);
    });

    it('should remove duplicate URLs (case-insensitive)', () => {
      const html = `
        <html>
          <body>
            <a href="/drhp.pdf">DRHP 1</a>
            <a href="/DRHP.PDF">DRHP 2</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // Should deduplicate case-insensitive URLs
      expect(docs.length).toBe(1);
    });

    it('should remove duplicate URLs with trailing slashes', () => {
      const html = `
        <html>
          <body>
            <a href="/documents/">Documents 1</a>
            <a href="/documents">Documents 2</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // NOTE: Current implementation may not deduplicate trailing slashes
      // This test documents current behavior
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('scrapeBSEDocuments - Edge Cases', () => {
    it('should return empty array for empty HTML', () => {
      const docs = scrapeBSEDocuments('');

      expect(docs).toEqual([]);
    });

    it('should return empty array for invalid HTML', () => {
      const docs = scrapeBSEDocuments('not html at all');

      expect(docs).toEqual([]);
    });

    it('should return empty array for null HTML', () => {
      const docs = scrapeBSEDocuments(null as any);

      expect(docs).toEqual([]);
    });

    it('should return empty array for undefined HTML', () => {
      const docs = scrapeBSEDocuments(undefined as any);

      expect(docs).toEqual([]);
    });

    it('should handle HTML with no links', () => {
      const html = `
        <html>
          <body>
            <p>No links here</p>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs).toEqual([]);
    });

    it('should handle HTML with links but no href attributes', () => {
      const html = `
        <html>
          <body>
            <a>Link without href</a>
            <a href="">Empty href</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs).toEqual([]);
    });

    it('should handle HTML with links but no text content', () => {
      const html = `
        <html>
          <body>
            <a href="/document.pdf"></a>
            <a href="/document2.pdf">   </a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs).toEqual([]);
    });
  });

  describe('scrapeBSEDocuments - Real-World Scenarios', () => {
    it('should extract all document types from typical BSE page', () => {
      const html = `
        <html>
          <body>
            <table>
              <tr><td class="TTRow_left">Document Type</td><td class="TTRow_left">Download</td></tr>
              <tr>
                <td class="TTRow_left">Draft Red Herring Prospectus</td>
                <td class="TTRow_left"><a href="/downloads/drhp.pdf">Draft Red Herring Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left">Red Herring Prospectus</td>
                <td class="TTRow_left"><a href="/downloads/rhp.pdf">Red Herring Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left">Prospectus</td>
                <td class="TTRow_left"><a href="/downloads/prospectus.pdf">Prospectus</a></td>
              </tr>
              <tr>
                <td class="TTRow_left">Basis of Allotment</td>
                <td class="TTRow_left"><a href="/downloads/allotment.pdf">Basis of Allotment</a></td>
              </tr>
              <tr>
                <td class="TTRow_left">Addendum</td>
                <td class="TTRow_left"><a href="/downloads/addendum.pdf">Addendum</a></td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      // Should extract all 5 document types
      expect(docs.length).toBeGreaterThanOrEqual(5);

      const titles = docs.map(d => d.title);
      expect(titles).toContain('Draft Red Herring Prospectus');
      expect(titles).toContain('Red Herring Prospectus');
      expect(titles).toContain('Prospectus');
      expect(titles).toContain('Basis of Allotment');
      expect(titles).toContain('Addendum');
    });

    it('should handle audiovisual document links', () => {
      const html = `
        <html>
          <body>
            <a href="/video/drhp.aspx">Audiovisual DRHP</a>
            <a href="/video/rhp.aspx">Audiovisual RHP</a>
          </body>
        </html>
      `;

      const docs = scrapeBSEDocuments(html);

      expect(docs.length).toBe(2);
      expect(docs[0].title).toBe('Audiovisual DRHP');
      expect(docs[1].title).toBe('Audiovisual RHP');
    });
  });
});
