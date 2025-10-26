/**
 * Unit Tests for CompanyContactCard Component (Story 11.14)
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CompanyContactCard } from '@/components/ipo-detail/CompanyContactCard';
import type { IpoDetails } from '@/lib/db/types';

// Helper to create mock IPO details
const createMockIpoDetails = (overrides?: Partial<IpoDetails>): IpoDetails => ({
  id: 'test-id',
  ipoId: 'ipo-test-id',
  issueType: null,
  freshIssue: null,
  ofsIssue: null,
  cutOffPrice: null,
  minInvestment: null,
  registrarLink: null,
  isin: null,
  faceValue: null,
  basisOfAllotmentDate: null,
  initiationOfRefundsDate: null,
  creditOfSharesDate: null,
  leadManagers: null,
  exchanges: null,
  companyDescription: null,
  dataSource: 'manual',
  lastVerifiedAt: null,
  companyAddress: null,
  companyPhone: null,
  companyEmail: null,
  companyCity: null,
  companyState: null,
  companyPincode: null,
  complianceOfficer: null,
  complianceOfficerPhone: null,
  complianceOfficerEmail: null,
  qibSharesOffered: null,
  niiSharesOffered: null,
  retailSharesOffered: null,
  retailMaxAllottees: null,
  employeeSharesOffered: null,
  anchorSharesOffered: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('CompanyContactCard', () => {
  describe('Empty State', () => {
    it('displays empty state message when no contact information is provided', () => {
      const ipoDetails = createMockIpoDetails();

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company Ltd"
        />
      );

      expect(screen.getByText('Company Contact Information')).toBeInTheDocument();
      expect(screen.getByText('Contact information not available')).toBeInTheDocument();
    });
  });

  describe('Full Contact Information', () => {
    it('renders all contact fields when populated', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '123 Main Street, Business Park',
        companyCity: 'Mumbai',
        companyState: 'Maharashtra',
        companyPincode: '400001',
        companyPhone: '+91 22 1234 5678',
        companyEmail: 'investor@testcompany.com',
        complianceOfficer: 'John Doe',
        complianceOfficerPhone: '+91 22 8765 4321',
        complianceOfficerEmail: 'compliance@testcompany.com',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company Ltd"
          website="https://www.testcompany.com"
        />
      );

      // Company name
      expect(screen.getByText('Test Company Ltd')).toBeInTheDocument();

      // Address
      expect(screen.getByText(/123 Main Street, Business Park/)).toBeInTheDocument();
      expect(screen.getByText(/Mumbai/)).toBeInTheDocument();
      expect(screen.getByText(/Maharashtra/)).toBeInTheDocument();
      expect(screen.getByText(/400001/)).toBeInTheDocument();

      // Contact details
      expect(screen.getByText('+91 22 1234 5678')).toBeInTheDocument();
      expect(screen.getByText('investor@testcompany.com')).toBeInTheDocument();
      expect(screen.getByText('https://www.testcompany.com')).toBeInTheDocument();

      // Compliance officer
      expect(screen.getByText('Compliance Officer')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('+91 22 8765 4321')).toBeInTheDocument();
      expect(screen.getByText('compliance@testcompany.com')).toBeInTheDocument();
    });
  });

  describe('Clickable Links', () => {
    it('renders phone link with correct tel: protocol', () => {
      const ipoDetails = createMockIpoDetails({
        companyPhone: '+911234567890',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      const phoneLink = screen.getByText('+911234567890');
      expect(phoneLink.closest('a')).toHaveAttribute('href', 'tel:+911234567890');
    });

    it('renders email link with correct mailto: protocol', () => {
      const ipoDetails = createMockIpoDetails({
        companyEmail: 'test@company.com',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      const emailLink = screen.getByText('test@company.com');
      expect(emailLink.closest('a')).toHaveAttribute('href', 'mailto:test@company.com');
    });

    it('renders website link with correct attributes', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '123 Main St', // Need some contact info to render
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
          website="https://www.example.com"
        />
      );

      const websiteLink = screen.getByText('https://www.example.com');
      const anchor = websiteLink.closest('a');
      expect(anchor).toHaveAttribute('href', 'https://www.example.com');
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders Google Maps link with encoded address', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '123 Main St',
        companyCity: 'Mumbai',
        companyState: 'Maharashtra',
        companyPincode: '400001',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      const mapsLink = screen.getByText('View on Google Maps');
      expect(mapsLink.closest('a')).toHaveAttribute(
        'href',
        expect.stringContaining('https://maps.google.com/?q=')
      );
      expect(mapsLink.closest('a')?.getAttribute('href')).toContain(
        encodeURIComponent('123 Main St, Mumbai, Maharashtra, 400001')
      );
    });
  });

  describe('Partial Contact Information', () => {
    it('renders only phone when other fields are null', () => {
      const ipoDetails = createMockIpoDetails({
        companyPhone: '+911234567890',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.getByText('+911234567890')).toBeInTheDocument();
      expect(screen.queryByText('Registered Office')).not.toBeInTheDocument();
      expect(screen.queryByText('Email (Investor Relations)')).not.toBeInTheDocument();
      expect(screen.queryByText('Compliance Officer')).not.toBeInTheDocument();
    });

    it('renders only compliance officer without other contact info', () => {
      const ipoDetails = createMockIpoDetails({
        complianceOfficer: 'Jane Smith',
        complianceOfficerEmail: 'jane@company.com',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.getByText('Compliance Officer')).toBeInTheDocument();
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
      expect(screen.getByText('jane@company.com')).toBeInTheDocument();
    });
  });

  describe('Compliance Officer Section', () => {
    it('does not render compliance officer section when officer name is null', () => {
      const ipoDetails = createMockIpoDetails({
        companyPhone: '+911234567890',
        complianceOfficer: null,
        complianceOfficerPhone: '+910987654321',
        complianceOfficerEmail: 'test@company.com',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.queryByText('Compliance Officer')).not.toBeInTheDocument();
    });

    it('renders compliance officer with only name (no phone/email)', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '123 St',
        complianceOfficer: 'John Doe',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.getByText('Compliance Officer')).toBeInTheDocument();
      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });
  });

  describe('Address Formatting', () => {
    it('formats full address correctly', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '123 Main Street',
        companyCity: 'Mumbai',
        companyState: 'Maharashtra',
        companyPincode: '400001',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.getByText(/123 Main Street, Mumbai, Maharashtra, 400001/)).toBeInTheDocument();
    });

    it('handles partial address components', () => {
      const ipoDetails = createMockIpoDetails({
        companyAddress: '456 Park Avenue',
        companyState: 'Delhi',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.getByText(/456 Park Avenue, Delhi/)).toBeInTheDocument();
    });
  });

  describe('Website Display', () => {
    it('does not render website section when website is null', () => {
      const ipoDetails = createMockIpoDetails({
        companyPhone: '+911234567890',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
          website={null}
        />
      );

      expect(screen.queryByText('Website')).not.toBeInTheDocument();
    });

    it('does not render website section when website is undefined', () => {
      const ipoDetails = createMockIpoDetails({
        companyPhone: '+911234567890',
      });

      render(
        <CompanyContactCard
          ipoDetails={ipoDetails}
          companyName="Test Company"
        />
      );

      expect(screen.queryByText('Website')).not.toBeInTheDocument();
    });
  });
});
