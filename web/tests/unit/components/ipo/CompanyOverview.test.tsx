/**
 * Unit tests for CompanyOverview (W-103): an IPO row can have risk factors
 * extracted from the RHP with no companyDescription (no price-band ad exists
 * yet) — the risk factors block must still render, and no empty
 * "Business Model" heading/paragraph should show.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompanyOverview, type RiskFactorItem } from '@/components/ipo/CompanyOverview';

const mockRiskItems: RiskFactorItem[] = [
  { seq: 1, heading: 'We depend on a small number of customers', body: 'Detailed body text.' },
  { seq: 2, heading: 'Our business is subject to regulatory risk', body: null },
];

describe('CompanyOverview - empty description with risk factors (W-103)', () => {
  it('renders the risk factors block with its count when description is empty', () => {
    render(<CompanyOverview companyDescription="" riskFactorItems={mockRiskItems} />);

    expect(screen.getByText('Risk Factors (2)')).toBeInTheDocument();
    expect(screen.getByText(/We depend on a small number of customers/)).toBeInTheDocument();
    expect(screen.getByText(/Our business is subject to regulatory risk/)).toBeInTheDocument();
  });

  it('does not render the Business Model heading or any description text when description is empty', () => {
    render(<CompanyOverview companyDescription="" riskFactorItems={mockRiskItems} />);

    expect(screen.queryByText('Business Model')).not.toBeInTheDocument();
  });

  it('renders nothing (no card sections) when description is empty and there are no risk items', () => {
    render(<CompanyOverview companyDescription="" riskFactorItems={[]} />);

    expect(screen.queryByText('Business Model')).not.toBeInTheDocument();
    expect(screen.queryByText(/Risk Factors/)).not.toBeInTheDocument();
  });

  it('still renders the Business Model section when a description is present', () => {
    render(<CompanyOverview companyDescription="A great company." riskFactorItems={[]} />);

    expect(screen.getByText('Business Model')).toBeInTheDocument();
    expect(screen.getByText('A great company.')).toBeInTheDocument();
  });
});
