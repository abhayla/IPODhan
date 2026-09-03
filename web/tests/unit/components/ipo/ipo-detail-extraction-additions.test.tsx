/**
 * Unit tests for the W-75 additions: the extraction-fed rows added INTO the
 * existing IPO-detail sections (valuation, allocation split, promoters,
 * intermediaries, risk factors, restated statements, statement KPIs).
 *
 * Every case is paired: the data renders when present, and the section looks
 * exactly as before when the new tables are empty — that is the contract the
 * page relies on for IPOs the filing extractor has never run against.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { IssueStructureSection } from '@/components/ipo/IssueStructureSection';
import { CategoryReservationSection } from '@/components/ipo-detail/CategoryReservationSection';
import { PromoterHoldingSection } from '@/components/ipo/PromoterHoldingSection';
import { LeadManagerSection } from '@/components/ipo-detail/LeadManagerSection';
import { CompanyOverview } from '@/components/ipo/CompanyOverview';
import { KPIHighlightSection } from '@/components/ipo-detail/KPIHighlightSection';
import { CompanyContactSection } from '@/components/ipo-detail/CompanyContactSection';
import type { IpoDetails } from '@/lib/repositories/types';

const valuation = {
  pricingEvent: 'PRICE_BAND_AD',
  priceFloor: '168.00',
  priceCap: '177.00',
  sharesAtFloor: '14880952.00',
  sharesAtCap: '14124293.00',
  mcapAtFloor: '16276000000.00',
  mcapAtCap: '17014000000.00',
  peAtFloor: '13.15',
  peAtCap: '13.85',
  peNotAscertainableReason: null,
  ronwWeighted3y: '45.26',
  faceValueMultipleFloor: '84.00',
  faceValueMultipleCap: '88.50',
};

describe('IssueStructureSection — valuation at the price band', () => {
  it('renders the floor/cap valuation rows from ipo_valuation', () => {
    render(
      <IssueStructureSection
        ipoDetails={null}
        valuation={valuation}
        faceValue={2}
        peerAveragePe={21.4}
      />
    );

    expect(screen.getByText('Valuation at the price band')).toBeInTheDocument();
    expect(screen.getByText('Market capitalisation')).toBeInTheDocument();
    // 16,276,000,000 rupees expressed in the crores the page uses elsewhere.
    expect(screen.getByText('₹1,627.6 Cr')).toBeInTheDocument();
    expect(screen.getByText('13.85x')).toBeInTheDocument();
    expect(screen.getByText('Price as a multiple of face value')).toBeInTheDocument();
    expect(screen.getByText('88.5x')).toBeInTheDocument();
    expect(screen.getByText('21.40x')).toBeInTheDocument(); // peer average P/E
    expect(screen.getByText('45.26%')).toBeInTheDocument(); // weighted RoNW
  });

  it('renders nothing extra when no valuation row exists', () => {
    render(<IssueStructureSection ipoDetails={{ issueType: 'BOOK_BUILDING' } as IpoDetails} />);
    expect(screen.queryByText('Valuation at the price band')).not.toBeInTheDocument();
  });
});

describe('CategoryReservationSection — allocation split and designated exchange', () => {
  it('renders the published split even when no per-category share counts exist', () => {
    render(
      <CategoryReservationSection
        reservationData={null}
        allocationPct={{ qib: 50, nii: 15, retail: 35 }}
        designatedExchange="BSE"
      />
    );

    expect(screen.getByText('Allocation as offered')).toBeInTheDocument();
    expect(screen.getByText('Qualified Institutional Buyers (QIB)')).toBeInTheDocument();
    expect(screen.getByText('50.00%')).toBeInTheDocument();
    expect(screen.getByText('BSE')).toBeInTheDocument();
  });

  it('still renders nothing when there is no reservation data at all', () => {
    const { container } = render(
      <CategoryReservationSection reservationData={null} allocationPct={null} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PromoterHoldingSection — named promoters and acquisition windows', () => {
  it('lists promoters, their cost per share and the acquisition windows', () => {
    render(
      <PromoterHoldingSection
        promoterHoldingPreIssue={48.79}
        promoterHoldingPostIssue={35.45}
        promoters={[{ name: 'Ashish Agarwal', sharesHeld: 1000, waca: '0.50' }]}
        acquisitionRanges={[{ period: '1Y', waca: '10.00', capMultiple: '17.70' }]}
        preIpoPlacement={false}
      />
    );

    expect(screen.getByText('Ashish Agarwal')).toBeInTheDocument();
    expect(screen.getByText('₹0.5')).toBeInTheDocument();
    expect(screen.getByText('Last 1 year')).toBeInTheDocument();
    expect(screen.getByText('17.70x')).toBeInTheDocument();
    expect(screen.getByText('Pre-IPO placement')).toBeInTheDocument();
  });

  it('renders only the percentages when no promoter rows exist', () => {
    render(
      <PromoterHoldingSection
        promoterHoldingPreIssue={48.79}
        promoterHoldingPostIssue={35.45}
      />
    );
    expect(screen.queryByText('Promoters')).not.toBeInTheDocument();
    expect(screen.getByText('48.79%')).toBeInTheDocument();
  });
});

describe('LeadManagerSection — intermediaries by role', () => {
  it('shows SEBI registration numbers, the BRLM track record and the other roles', () => {
    render(
      <LeadManagerSection
        leadManagers={null}
        intermediaries={[
          { role: 'BRLM', name: 'Emkay Global', sebiRegNo: 'INM000011523' },
          { role: 'REGISTRAR', name: 'Bigshare Services', sebiRegNo: 'INR000001385' },
          { role: 'SUB_SYNDICATE', name: 'Kotak Securities', sebiRegNo: null },
        ]}
        brlmTrackRecords={[
          { brlmName: 'Emkay Global', issues3y: 4, closedBelowIssuePrice: 2 },
        ]}
      />
    );

    expect(screen.getByText('Emkay Global')).toBeInTheDocument();
    expect(screen.getByText(/INM000011523/)).toBeInTheDocument();
    expect(screen.getByText(/4 issues in the last 3/)).toBeInTheDocument();
    expect(screen.getByText('Registrar to the issue')).toBeInTheDocument();
    expect(screen.getByText('Sub-syndicate members')).toBeInTheDocument();
  });

  // W-88 E6: the price band advertisement's sponsor / escrow-collection /
  // public-issue account banks now reach ipo_intermediaries, so the section
  // renders a group per bank role with the bank named in it.
  it('W-88: groups the sponsor, escrow and public-issue banks under their own headings', () => {
    render(
      <LeadManagerSection
        leadManagers={null}
        intermediaries={[
          { role: 'BRLM', name: 'Emkay Global', sebiRegNo: null },
          { role: 'SPONSOR_BANK', name: 'HDFC Bank Limited', sebiRegNo: null },
          { role: 'SPONSOR_BANK', name: 'ICICI Bank Limited', sebiRegNo: null },
          { role: 'ESCROW_BANK', name: 'ICICI Bank Limited', sebiRegNo: null },
          { role: 'PUBLIC_ISSUE_BANK', name: 'HDFC Bank Limited', sebiRegNo: null },
        ]}
      />
    );

    expect(screen.getByText('Sponsor banks')).toBeInTheDocument();
    expect(screen.getByText('Escrow collection banks')).toBeInTheDocument();
    expect(screen.getByText('Public issue banks')).toBeInTheDocument();
    // Substance: the bank names themselves, once per role they hold.
    expect(screen.getAllByText('HDFC Bank Limited')).toHaveLength(2);
    expect(screen.getAllByText('ICICI Bank Limited')).toHaveLength(2);
  });

  it('omits every bank heading when the issue named no banks', () => {
    render(
      <LeadManagerSection
        leadManagers={null}
        intermediaries={[{ role: 'BRLM', name: 'Emkay Global', sebiRegNo: null }]}
      />
    );

    expect(screen.queryByText('Sponsor banks')).not.toBeInTheDocument();
    expect(screen.queryByText('Escrow collection banks')).not.toBeInTheDocument();
    expect(screen.queryByText('Public issue banks')).not.toBeInTheDocument();
  });

  it('falls back to the legacy leadManagers array when no intermediaries exist', () => {
    render(<LeadManagerSection leadManagers={['Legacy BRLM']} />);
    expect(screen.getByText('Legacy BRLM')).toBeInTheDocument();
    expect(screen.queryByText('Registrar to the issue')).not.toBeInTheDocument();
  });

  it('renders nothing when neither source has data', () => {
    const { container } = render(<LeadManagerSection leadManagers={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CompanyOverview — risk factors from the offer document', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({
    seq: i + 1,
    heading: `Risk heading ${i + 1}`,
    body: null,
  }));

  it('collapses to five headings with a show-all control', () => {
    render(<CompanyOverview companyDescription="A business." riskFactorItems={items} />);
    expect(screen.getByText('Risk Factors (8)')).toBeInTheDocument();
    expect(screen.getByText('Risk heading 5')).toBeInTheDocument();
    expect(screen.queryByText('Risk heading 6')).not.toBeInTheDocument();
    expect(screen.getByText('Show all 8 risk factors')).toBeInTheDocument();
  });

  it('renders no risk block when the extractor found none', () => {
    render(<CompanyOverview companyDescription="A business." />);
    expect(screen.queryByText(/Risk Factors/)).not.toBeInTheDocument();
  });
});

describe('KPIHighlightSection — statement extras and concentration', () => {
  it('renders DSCR, rent, the reporting basis and concentration percentages', () => {
    render(
      <KPIHighlightSection
        financialData={null}
        ipoData={null}
        statements={[
          {
            fiscalYear: 2026,
            basis: 'RESTATED',
            unit: 'MILLION',
            dscr: '1.85',
            rentExpense: '120.00',
          },
        ]}
        concentrationKpis={[
          { label: 'Top 10 customers', valuePct: 64.67, fiscalYear: 2026 },
        ]}
      />
    );

    expect(screen.getByText('Debt service coverage ratio (DSCR)')).toBeInTheDocument();
    expect(screen.getByText('1.85')).toBeInTheDocument();
    expect(screen.getByText('Rent expense (₹ Cr)')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // 120 million = 12 crore
    expect(screen.getByText('Top 10 customers (FY2026)')).toBeInTheDocument();
    expect(screen.getByText('64.67%')).toBeInTheDocument();
  });

  it('keeps the old not-available card when there is nothing new either', () => {
    render(<KPIHighlightSection financialData={null} ipoData={null} />);
    expect(screen.getByText('KPI Data Not Available')).toBeInTheDocument();
  });
});

describe('CompanyContactSection — CIN', () => {
  it('shows the CIN when the company filing carries one', () => {
    render(
      <CompanyContactSection
        contactData={{
          companyAddress: null,
          companyPhone: null,
          companyEmail: null,
          companyCity: null,
          companyState: null,
          companyPincode: null,
          complianceOfficer: null,
          complianceOfficerPhone: null,
          complianceOfficerEmail: null,
          cin: 'U36911TN2010PLC078123',
        }}
      />
    );
    expect(screen.getByText('Corporate Identity Number (CIN)')).toBeInTheDocument();
    expect(screen.getByText('U36911TN2010PLC078123')).toBeInTheDocument();
  });
});
