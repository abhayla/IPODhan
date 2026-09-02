/**
 * W-02 (2026-09-02): NSE's list endpoints (`/api/ipo-current-issue`,
 * `/api/all-upcoming-issues`) do not carry a face value field, so
 * `transformIPOData()` was writing a fabricated `10` for every IPO via
 * `parseFloat(data.faceValue) || 10`. NSE ranks above BSE in the field
 * priority matrix, so this fabricated 10 silently overrode BSE's correct
 * value (e.g. Deepa Jewellers: NSE wrote 10, real face value is 2 per both
 * BSE detail and NSE's own issueInfo.dataList "Face Value" row).
 *
 * Fix: `faceValue` is undefined when the list payload has no face value,
 * and `extractAdditionalNSEFields()` parses a real face value out of
 * `issueInfo.dataList` when NSE's detail payload is present.
 */

import { describe, it, expect } from 'vitest';
import { transformIPOData } from '../../../src/scrapers/nse-api-client.js';

describe('transformIPOData faceValue (W-02 fix)', () => {
  it('leaves faceValue undefined when the list payload has no face value field', () => {
    const data = {
      companyName: 'Deepa Jewellers Limited',
      symbol: 'DEEPA',
      series: 'EQ',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.faceValue).toBeUndefined();
  });

  it('parses a genuine numeric faceValue from the list payload when present', () => {
    const data = {
      companyName: 'Test Company Ltd',
      symbol: 'TEST',
      series: 'EQ',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      faceValue: '2',
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.faceValue).toBe(2);
  });

  it('parses "Face Value" out of issueInfo.dataList: "Rs. 2 per Equity Share" -> 2', () => {
    const data = {
      companyName: 'Deepa Jewellers Limited',
      symbol: 'DEEPA',
      series: 'EQ',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      issueInfo: {
        dataList: [
          { title: 'Face Value', value: 'Rs. 2 per Equity Share' },
        ],
      },
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.faceValue).toBe(2);
  });

  it('parses "Face Value" out of issueInfo.dataList: "Rs. 10 per Equity Share" -> 10', () => {
    const data = {
      companyName: 'Test Company Ltd',
      symbol: 'TEST',
      series: 'EQ',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      issueInfo: {
        dataList: [
          { title: 'Face Value', value: 'Rs. 10 per Equity Share' },
        ],
      },
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.faceValue).toBe(10);
  });

  it('the issueInfo-derived faceValue overrides a missing list-level value', () => {
    const data = {
      companyName: 'Deepa Jewellers Limited',
      symbol: 'DEEPA',
      series: 'EQ',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      issueInfo: {
        dataList: [
          { title: 'Cut-off time for UPI', value: 'upto 5:00 PM' },
          { title: 'Face Value', value: 'Rs.2/-' },
        ],
      },
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.faceValue).toBe(2);
  });
});
