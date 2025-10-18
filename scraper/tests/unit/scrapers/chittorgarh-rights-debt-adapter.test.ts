/**
 * Unit tests for chittorgarh-rights-debt-adapter.ts
 * Tests: NCD API integration fix, pagination, error handling, data transformation
 * Story: 11.6 - Fix Chittorgarh NCD API Integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchRightsIssuesFromChittorgarh,
  fetchDebtIssuesFromChittorgarh,
} from '../../../src/scrapers/chittorgarh-rights-debt-adapter.js';

// Mock global fetch
global.fetch = vi.fn();

describe('chittorgarh-rights-debt-adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchDebtIssuesFromChittorgarh - Story 11.6 NCD API Fix', () => {
    it('should successfully fetch NCD data using "all" category with pagination', async () => {
      // Mock API responses for pagination (2 pages)
      const mockPage1Response = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/smc-global-ncd/1/">SMC Global Securities NCD</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Listing Date': '',
            'Issue Price (Rs.)': '1000.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '150.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '<a href="/lead-manager/1/">ABC Capital</a>',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '10 Shares (Rs. 10,000)',
            'Face Value (Rs.)': '1000.00',
            Registrar: '<a href="/registrar/1/">Link Intime</a>',
          },
          // 9 more non-NCD records to simulate pagination
          ...Array(9).fill({
            Company: '<a href="/ipo/test-ipo/1/">Test Mainboard IPO</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '100.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '50.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '100 Shares',
            'Face Value (Rs.)': '10.00',
            Registrar: '',
          }),
        ],
      };

      const mockPage2Response = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/indel-money-bond/2/">Indel Money Limited Bond</a>',
            'Opening Date': 'Wed, Oct 15, 2025',
            'Closing Date': 'Fri, Oct 17, 2025',
            'Issue Price (Rs.)': '1000.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '100.00',
            'Listing at': 'BSE',
            'Lead Manager': '<a href="/lead-manager/2/">XYZ Investments</a>',
            '~Issue_Open_Date': '2025-10-15T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-17T00:00:00.000Z',
            'Minimum Application': '1 Shares (Rs. 1,000)',
            'Face Value (Rs.)': '1000.00',
            Registrar: '<a href="/registrar/2/">Karvy</a>',
          },
        ],
      };

      // Setup fetch mock
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPage1Response,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockPage2Response,
        });

      const results = await fetchDebtIssuesFromChittorgarh();

      // Should have filtered 2 NCD/Bond records from the responses
      expect(results).toHaveLength(2);
      expect(results[0].companyName).toBe('SMC Global Securities NCD');
      expect(results[0].category).toBe('NCD');
      expect(results[0].dataSource).toBe('CHITTORGARH');
      expect(results[0].issueSize).toBe(1500000000); // 150 Cr
      expect(results[1].companyName).toBe('Indel Money Limited Bond');

      // Verify API was called with correct parameters
      expect(global.fetch).toHaveBeenCalledTimes(2);

      // Check first call (page 1)
      const firstCall = (global.fetch as any).mock.calls[0][0];
      expect(firstCall).toContain('/cloud/report/data-read/82/1/10/'); // perPage=10
      expect(firstCall).toContain('/all/0'); // category=all
      expect(firstCall).toContain('v=20-47'); // updated version

      // Check second call (page 2)
      const secondCall = (global.fetch as any).mock.calls[1][0];
      expect(secondCall).toContain('/82/2/10/'); // page 2
    });

    it('should handle "Invalid API Call2025-100-01" error and return empty array', async () => {
      const mockErrorResponse = {
        msg: -1,
        error: 'Invalid API Call2025-100-01',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      const results = await fetchDebtIssuesFromChittorgarh();

      expect(results).toHaveLength(0);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should handle "No params data found" error gracefully', async () => {
      const mockErrorResponse = {
        msg: -1,
        error: 'No params data found.',
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockErrorResponse,
      });

      const results = await fetchDebtIssuesFromChittorgarh();

      expect(results).toHaveLength(0);
    });

    it('should stop pagination after 50 pages (safety limit)', async () => {
      const mockResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: Array(10).fill({
          Company: '<a href="/ipo/test/1/">Test NCD</a>',
          'Opening Date': 'Mon, Oct 07, 2025',
          'Closing Date': 'Thu, Oct 09, 2025',
          'Issue Price (Rs.)': '1000.00',
          'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '100.00',
          'Listing at': 'BSE',
          'Lead Manager': '',
          '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
          '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
          'Minimum Application': '1 Shares',
          'Face Value (Rs.)': '1000.00',
          Registrar: '',
        }),
      };

      // Mock infinite pagination (always returns 10 records)
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      const results = await fetchDebtIssuesFromChittorgarh();

      // Should stop after 50 pages
      expect(global.fetch).toHaveBeenCalledTimes(50);
      expect(results.length).toBeLessThanOrEqual(500); // 50 pages * 10 records/page
    });

    it('should filter out non-NCD records', async () => {
      const mockResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/ncd-company/1/">Company NCD</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '1000.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '100.00',
            'Listing at': 'BSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '1 Shares',
            'Face Value (Rs.)': '1000.00',
            Registrar: '',
          },
          {
            Company: '<a href="/ipo/regular-ipo/2/">Regular Mainboard IPO</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '100.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '50.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '100 Shares',
            'Face Value (Rs.)': '10.00',
            Registrar: '',
          },
          {
            Company: '<a href="/ipo/bond-issue/3/">Corporate Bond Issue</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '1000.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '200.00',
            'Listing at': 'BSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '5 Shares',
            'Face Value (Rs.)': '1000.00',
            Registrar: '',
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      });

      const results = await fetchDebtIssuesFromChittorgarh();

      // Should only include NCD and Bond records (2 out of 3)
      expect(results).toHaveLength(2);
      expect(results[0].companyName).toBe('Company NCD');
      expect(results[1].companyName).toBe('Corporate Bond Issue');
    });

    it(
      'should handle network errors gracefully',
      async () => {
        (global.fetch as any).mockRejectedValueOnce(new Error('Network timeout'));

        const results = await fetchDebtIssuesFromChittorgarh();

        expect(results).toHaveLength(0);
      },
      { timeout: 15000 } // Allow time for retries (3 retries with exponential backoff)
    );

    it(
      'should handle HTTP errors gracefully',
      async () => {
        (global.fetch as any).mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        });

        const results = await fetchDebtIssuesFromChittorgarh();

        expect(results).toHaveLength(0);
      },
      { timeout: 15000 } // Allow time for retries
    );
  });

  describe('fetchRightsIssuesFromChittorgarh - Regression Tests', () => {
    it('should still fetch REIT data with updated parameters', async () => {
      const mockReitResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/test-reit/1/">Test REIT IPO</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '500.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '1000.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '<a href="/lead-manager/1/">ABC Capital</a>',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '20 Shares (Rs. 10,000)',
            'Face Value (Rs.)': '100.00',
            Registrar: '<a href="/registrar/1/">Link Intime</a>',
          },
        ],
      };

      const mockInvitResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [],
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReitResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInvitResponse,
        });

      const results = await fetchRightsIssuesFromChittorgarh();

      expect(results).toHaveLength(1);
      expect(results[0].companyName).toBe('Test REIT IPO');
      expect(results[0].category).toBe('RIGHTS');

      // Verify API calls used correct parameters
      const firstCall = (global.fetch as any).mock.calls[0][0];
      expect(firstCall).toContain('/10/'); // perPage=10 (not 100)
      expect(firstCall).toContain('v=20-47'); // updated version
      expect(firstCall).toContain('/reit/0'); // category=reit
    });

    it('should fetch both REIT and InvIT data', async () => {
      const mockReitResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/reit-1/1/">REIT Issue 1</a>',
            'Opening Date': 'Mon, Oct 07, 2025',
            'Closing Date': 'Thu, Oct 09, 2025',
            'Issue Price (Rs.)': '500.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '1000.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
            'Minimum Application': '20 Shares',
            'Face Value (Rs.)': '100.00',
            Registrar: '',
          },
        ],
      };

      const mockInvitResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [
          {
            Company: '<a href="/ipo/invit-1/2/">InvIT Issue 1</a>',
            'Opening Date': 'Wed, Oct 15, 2025',
            'Closing Date': 'Fri, Oct 17, 2025',
            'Issue Price (Rs.)': '600.00',
            'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '800.00',
            'Listing at': 'BSE, NSE',
            'Lead Manager': '',
            '~Issue_Open_Date': '2025-10-15T00:00:00.000Z',
            '~IssueCloseDate': '2025-10-17T00:00:00.000Z',
            'Minimum Application': '10 Shares',
            'Face Value (Rs.)': '100.00',
            Registrar: '',
          },
        ],
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockReitResponse,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockInvitResponse,
        });

      const results = await fetchRightsIssuesFromChittorgarh();

      expect(results).toHaveLength(2);
      expect(results[0].companyName).toBe('REIT Issue 1');
      expect(results[1].companyName).toBe('InvIT Issue 1');
      expect(results[0].category).toBe('RIGHTS');
      expect(results[1].category).toBe('RIGHTS');
    });
  });

  describe('API URL Construction', () => {
    it('should construct URL with correct parameters', async () => {
      const mockResponse = {
        msg: 1,
        sSearchWhere: '',
        reportTableData: [],
      };

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      await fetchDebtIssuesFromChittorgarh();

      const url = (global.fetch as any).mock.calls[0][0];

      // Verify URL structure
      expect(url).toContain('webnodejs.chittorgarh.com/cloud/report/data-read');
      expect(url).toContain('/82/'); // Report ID
      expect(url).toContain('/1/'); // Page number
      expect(url).toContain('/10/'); // perPage limit (not 100)
      expect(url).toContain('/2025/'); // Current year (or test year)
      expect(url).toContain('/2025-26/'); // Year range
      expect(url).toContain('/all/0'); // Category=all (not ncd)
      expect(url).toContain('v=20-47'); // Updated version parameter
    });
  });
});
