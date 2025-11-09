/**
 * Admin Documentation Tooltip System
 *
 * Provides contextual help with regulatory references and examples
 * Part of Day 4: Admin Enhancement (2025-11-09)
 *
 * Features:
 * - SEBI ICDR Regulation references
 * - NSE/BSE documentation links
 * - Real-world examples
 * - Field-specific guidance
 */

'use client';

import { useState } from 'react';

export interface TooltipContent {
  summary: string;
  details?: string;
  examples?: string[];
  regulatoryReference?: {
    source: 'SEBI' | 'NSE' | 'BSE' | 'Companies Act';
    regulation: string;
    section?: string;
    url?: string;
  };
  learnMore?: {
    title: string;
    url: string;
  }[];
  bestPractices?: string[];
}

interface TooltipSystemProps {
  content: TooltipContent;
  position?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click';
  maxWidth?: string;
}

export function TooltipSystem({
  content,
  position = 'right',
  trigger = 'hover',
  maxWidth = '400px',
}: TooltipSystemProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleMouseEnter = () => {
    if (trigger === 'hover') setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (trigger === 'hover') setIsOpen(false);
  };

  const handleClick = () => {
    if (trigger === 'click') setIsOpen(!isOpen);
  };

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900',
  };

  return (
    <div className="relative inline-block">
      {/* Trigger Icon */}
      <button
        type="button"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="inline-flex items-center justify-center w-5 h-5 text-gray-400 hover:text-blue-600 transition-colors cursor-help"
        aria-label="Show help"
      >
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Tooltip Content */}
      {isOpen && (
        <div
          className={`absolute z-50 ${positionClasses[position]}`}
          style={{ maxWidth }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {/* Arrow */}
          <div
            className={`absolute w-0 h-0 border-8 border-transparent ${arrowClasses[position]}`}
          />

          {/* Tooltip Card */}
          <div className="bg-gray-900 text-white rounded-lg shadow-xl p-4 text-sm">
            {/* Summary */}
            <div className="font-medium mb-2">{content.summary}</div>

            {/* Details */}
            {content.details && (
              <div className="text-gray-300 mb-3 leading-relaxed">
                {content.details}
              </div>
            )}

            {/* Examples */}
            {content.examples && content.examples.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-blue-300 uppercase tracking-wide mb-1.5">
                  Examples:
                </div>
                <ul className="space-y-1">
                  {content.examples.map((example, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-300">
                      <span className="text-blue-400 mt-0.5">•</span>
                      <span className="flex-1">{example}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Best Practices */}
            {content.bestPractices && content.bestPractices.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-green-300 uppercase tracking-wide mb-1.5">
                  Best Practices:
                </div>
                <ul className="space-y-1">
                  {content.bestPractices.map((practice, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-300">
                      <span className="text-green-400 mt-0.5">✓</span>
                      <span className="flex-1">{practice}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Regulatory Reference */}
            {content.regulatoryReference && (
              <div className="mb-3 p-2 bg-gray-800 rounded border border-gray-700">
                <div className="text-xs font-semibold text-yellow-300 uppercase tracking-wide mb-1">
                  📋 Regulatory Reference
                </div>
                <div className="text-gray-300">
                  <div className="font-medium">
                    {content.regulatoryReference.source}: {content.regulatoryReference.regulation}
                  </div>
                  {content.regulatoryReference.section && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      Section {content.regulatoryReference.section}
                    </div>
                  )}
                  {content.regulatoryReference.url && (
                    <a
                      href={content.regulatoryReference.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 text-xs underline mt-1 inline-block"
                    >
                      View Full Text →
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Learn More Links */}
            {content.learnMore && content.learnMore.length > 0 && (
              <div className="pt-2 border-t border-gray-700">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Learn More:
                </div>
                <div className="space-y-1">
                  {content.learnMore.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      <span className="text-xs">{link.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Predefined tooltip content for common IPO fields
 */
export const adminTooltips: Record<string, Record<string, TooltipContent>> = {
  ipos: {
    lotSize: {
      summary: 'Minimum number of shares per application',
      details: 'Applications must be in multiples of the lot size. SEBI mandates minimum application value between ₹10,000-15,000 for retail investors.',
      examples: [
        'Lot size 125, Price ₹100 → Min application ₹12,500',
        'Lot size 75, Price ₹150 → Min application ₹11,250',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '32(2)',
        url: 'https://www.sebi.gov.in/legal/regulations/jul-2018/securities-and-exchange-board-of-india-issue-of-capital-and-disclosure-requirements-regulations-2018_39961.html',
      },
      bestPractices: [
        'Verify lot size allows minimum application ≥ ₹10,000',
        'Round to multiples of 5 or 10 for easier calculations',
      ],
      learnMore: [
        {
          title: 'NSE IPO Application Guide',
          url: 'https://www.nseindia.com/invest/ipo-application',
        },
      ],
    },
    priceRangeMin: {
      summary: 'Lower end of the price band (floor price)',
      details: 'The minimum price at which shares will be offered. Price band must not exceed 20% of the floor price for mainboard IPOs.',
      examples: [
        'Price band ₹100-120 → 20% range (valid)',
        'Price band ₹100-130 → 30% range (invalid for mainboard)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '26(4)',
        url: 'https://www.sebi.gov.in/legal/regulations/jul-2018/securities-and-exchange-board-of-india-issue-of-capital-and-disclosure-requirements-regulations-2018_39961.html',
      },
      bestPractices: [
        'Mainboard: Price band ≤ 20% of floor price',
        'SME: Price band ≤ 40% of floor price',
      ],
    },
    priceRangeMax: {
      summary: 'Upper end of the price band (cap price)',
      details: 'The maximum price at which shares will be offered. Final issue price is discovered through book building within this band.',
      examples: [
        'If band is ₹100-120, issue price will be between this range',
        'Retail investors can bid at "cut-off" (highest price)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '26(4)',
      },
      learnMore: [
        {
          title: 'NSE Book Building Process',
          url: 'https://www.nseindia.com/invest/book-building',
        },
      ],
    },
    minInvestment: {
      summary: 'Minimum amount required to apply',
      details: 'Calculated as Lot Size × Price. SEBI requires minimum investment between ₹10,000-15,000 for retail category.',
      examples: [
        'Lot 125 × ₹100 = ₹12,500 (valid)',
        'Lot 50 × ₹150 = ₹7,500 (invalid, below ₹10,000)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '32(2)',
      },
      bestPractices: [
        'Ensure minimum investment ≥ ₹10,000 for retail',
        'Maximum retail application: ₹2,00,000',
      ],
    },
    issueSize: {
      summary: 'Total capital to be raised through the IPO',
      details: 'Sum of fresh issue and offer for sale (OFS). For mainboard IPOs, minimum post-issue paid-up capital must be ₹10 crore.',
      examples: [
        'Fresh Issue ₹500 Cr + OFS ₹300 Cr = Total ₹800 Cr',
        'Pure OFS (no fresh capital raised)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '6(1)',
        url: 'https://www.sebi.gov.in/legal/regulations/jul-2018/securities-and-exchange-board-of-india-issue-of-capital-and-disclosure-requirements-regulations-2018_39961.html',
      },
      learnMore: [
        {
          title: 'SEBI IPO Eligibility Criteria',
          url: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=4&smid=0',
        },
      ],
    },
    listingDate: {
      summary: 'Date when shares start trading on stock exchanges',
      details: 'Must be within 6 working days of issue closure for mainboard IPOs, 12 days for SME IPOs.',
      examples: [
        'Close: Jan 10 → Listing: Jan 12-18 (mainboard)',
        'Close: Jan 10 → Listing: Jan 12-26 (SME)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '55',
      },
      bestPractices: [
        'Allow 3-4 days for allotment finalization',
        'T+6 timeline for mainboard IPOs',
      ],
    },
  },
  subscriptions: {
    qibSubscription: {
      summary: 'Qualified Institutional Buyers subscription multiple',
      details: 'QIB quota is 50% of issue size for mainboard IPOs. Includes mutual funds, FIIs, insurance companies, banks.',
      examples: [
        '1.5x → 50% oversubscribed',
        '10x → 900% oversubscribed (highly positive)',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '38(1)',
      },
      bestPractices: [
        'QIB >2x indicates strong institutional interest',
        'QIB <1x may signal valuation concerns',
      ],
      learnMore: [
        {
          title: 'NSE QIB Subscription Data',
          url: 'https://www.nseindia.com/market-data/qib-subscription',
        },
      ],
    },
    niiSubscription: {
      summary: 'Non-Institutional Investors subscription multiple',
      details: 'NII quota is at least 15% of issue size. Includes HNIs applying for >₹2 lakh.',
      examples: [
        '5x → Strong HNI interest',
        '0.8x → Undersubscribed',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '38(1)',
      },
      bestPractices: [
        'NII >3x indicates good HNI demand',
      ],
    },
    retailSubscription: {
      summary: 'Retail investors subscription multiple',
      details: 'Retail quota is at least 35% of issue size. For individual investors applying up to ₹2 lakh.',
      examples: [
        '2x → Good retail participation',
        '10x → Exceptional retail demand',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '38(1)',
      },
      bestPractices: [
        'Retail >2x often leads to listing gains',
        'Check for preferential allotment if oversubscribed',
      ],
    },
  },
  financialData: {
    peRatio: {
      summary: 'Price-to-Earnings ratio at issue price',
      details: 'Indicates valuation relative to earnings. Compare with industry average to assess if IPO is fairly priced.',
      examples: [
        'P/E 25, Industry avg 30 → Attractively priced',
        'P/E 50, Industry avg 25 → Premium valuation',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: 'Schedule VIII - Basis of Issue Price',
      },
      bestPractices: [
        'Compare with industry peers',
        'Consider growth prospects for high P/E',
      ],
      learnMore: [
        {
          title: 'NSE Industry P/E Ratios',
          url: 'https://www.nseindia.com/market-data/industry-pe',
        },
      ],
    },
    roe: {
      summary: 'Return on Equity - profitability metric',
      details: 'Net Profit / Shareholders Equity × 100. Measures efficiency in generating returns from equity capital.',
      examples: [
        'ROE 15% → Good for mature companies',
        'ROE 25%+ → Excellent capital efficiency',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: 'Schedule VIII',
      },
      bestPractices: [
        'ROE >15% is generally good',
        'Compare with industry benchmarks',
        'Check consistency over 3 years',
      ],
    },
    debtToEquity: {
      summary: 'Debt-to-Equity ratio - leverage indicator',
      details: 'Total Debt / Shareholders Equity. Measures financial leverage and risk. Lower is generally better.',
      examples: [
        'D/E 0.5 → Conservative leverage',
        'D/E 2.0 → High leverage (risky)',
      ],
      regulatoryReference: {
        source: 'Companies Act',
        regulation: 'Companies Act, 2013',
        section: 'Schedule III',
      },
      bestPractices: [
        'D/E <1.0 is generally safe',
        'Capital-intensive industries may have higher D/E',
        'Check interest coverage ratio alongside',
      ],
    },
  },
  gmpRecords: {
    gmpPrice: {
      summary: 'Grey Market Premium - unofficial pre-listing premium',
      details: 'Indicates expected listing gain based on unofficial grey market trading. Not regulated by SEBI.',
      examples: [
        'Issue Price ₹100, GMP ₹20 → Expected listing ₹120 (+20%)',
        'Negative GMP indicates expected listing loss',
      ],
      bestPractices: [
        'GMP is indicative, not guaranteed',
        'High GMP may lead to profit booking on listing',
        'Use as one of many decision factors',
      ],
      learnMore: [
        {
          title: 'Understanding Grey Market Premium',
          url: 'https://www.moneycontrol.com/news/business/ipo/what-is-grey-market-premium-gmp-in-ipos-2345678.html',
        },
      ],
    },
  },
  documents: {
    documentType: {
      summary: 'Type of IPO document',
      details: 'DRHP (Draft Red Herring Prospectus), RHP (Red Herring Prospectus), Prospectus, etc.',
      examples: [
        'DRHP → Filed with SEBI, subject to changes',
        'RHP → Final version before IPO opens',
        'Prospectus → Post-pricing document',
      ],
      regulatoryReference: {
        source: 'SEBI',
        regulation: 'ICDR Regulations, 2018',
        section: '31-32',
      },
      bestPractices: [
        'Always read RHP before investing',
        'Check "Risk Factors" section carefully',
        'Verify use of proceeds',
      ],
      learnMore: [
        {
          title: 'SEBI Document Requirements',
          url: 'https://www.sebi.gov.in/legal/circulars/jan-2019/disclosure-requirements-in-offer-document_41577.html',
        },
      ],
    },
  },
};

/**
 * Helper function to get tooltip content for a specific field
 */
export function getTooltipContent(
  tableName: string,
  fieldName: string
): TooltipContent | null {
  return adminTooltips[tableName]?.[fieldName] || null;
}

/**
 * Inline helper component for quick tooltip usage
 */
interface FieldTooltipProps {
  tableName: string;
  fieldName: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  trigger?: 'hover' | 'click';
}

export function FieldTooltip({
  tableName,
  fieldName,
  position = 'right',
  trigger = 'hover',
}: FieldTooltipProps) {
  const content = getTooltipContent(tableName, fieldName);

  if (!content) {
    return null; // No tooltip available for this field
  }

  return <TooltipSystem content={content} position={position} trigger={trigger} />;
}
