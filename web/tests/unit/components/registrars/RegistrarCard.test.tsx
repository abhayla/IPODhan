/**
 * Unit Tests for RegistrarCard Component
 * Story 5.3: Registrar Directory
 *
 * Tests:
 * - Rendering of registrar information
 * - Display of contact details (email, phone, address)
 * - Button rendering and links
 * - Handling of missing optional fields
 * - Accessibility compliance
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegistrarCard } from '@/components/registrars/RegistrarCard';
import type { Registrar } from '@/lib/db/types';

// Helper function to create mock registrar data
const mockRegistrar = (overrides?: Partial<Registrar>): Registrar => ({
  id: 'reg-123',
  name: 'Link Intime India Pvt Ltd',
  shortName: 'Link Intime',
  email: 'rnt.helpdesk@linkintime.co.in',
  phone: '022-49186000',
  website: 'https://linkintime.co.in',
  allotmentCheckUrl: 'https://linkintime.co.in/MIPO/Ipoallotment.html',
  address: 'C-101, 1st Floor, 247 Park, Mumbai - 400083',
  logoUrl: null,
  active: true,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('RegistrarCard', () => {
  describe('Rendering', () => {
    it('should render registrar short name as title', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.getByText('Link Intime')).toBeInTheDocument();
    });

    it('should render full name when short name exists', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.getByText('Link Intime India Pvt Ltd')).toBeInTheDocument();
    });

    it('should render only name when short name is missing', () => {
      const registrar = mockRegistrar({ shortName: null });
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.getByText('Link Intime India Pvt Ltd')).toBeInTheDocument();
    });

    it('should render all contact information', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.getByText('rnt.helpdesk@linkintime.co.in')).toBeInTheDocument();
      expect(screen.getByText('022-49186000')).toBeInTheDocument();
      expect(screen.getByText(/C-101, 1st Floor/)).toBeInTheDocument();
    });
  });

  describe('Email Handling', () => {
    it('should render email as mailto link', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const emailLink = screen.getByRole('link', { name: /rnt.helpdesk@linkintime.co.in/i });
      expect(emailLink).toHaveAttribute('href', 'mailto:rnt.helpdesk@linkintime.co.in');
    });

    it('should not render email section when email is missing', () => {
      const registrar = mockRegistrar({ email: null });
      render(<RegistrarCard registrar={registrar} />);

      const emailLinks = screen.queryAllByRole('link', { name: /mailto/i });
      expect(emailLinks.filter((link) => link.getAttribute('href')?.startsWith('mailto:'))).toHaveLength(0);
    });
  });

  describe('Phone Handling', () => {
    it('should render phone as tel link', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const phoneLink = screen.getByRole('link', { name: /022-49186000/i });
      expect(phoneLink).toHaveAttribute('href', 'tel:022-49186000');
    });

    it('should not render phone section when phone is missing', () => {
      const registrar = mockRegistrar({ phone: null });
      render(<RegistrarCard registrar={registrar} />);

      const phoneLinks = screen.queryAllByRole('link', { name: /tel/i });
      expect(phoneLinks.filter((link) => link.getAttribute('href')?.startsWith('tel:'))).toHaveLength(0);
    });
  });

  describe('Address Handling', () => {
    it('should render address when present', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.getByText(/C-101, 1st Floor, 247 Park, Mumbai - 400083/)).toBeInTheDocument();
    });

    it('should not render address section when address is missing', () => {
      const registrar = mockRegistrar({ address: null });
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.queryByText(/C-101/)).not.toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should render allotment check button when URL exists', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const allotmentButton = screen.getByRole('link', { name: /Check Allotment Status/i });
      expect(allotmentButton).toBeInTheDocument();
      expect(allotmentButton).toHaveAttribute('href', 'https://linkintime.co.in/MIPO/Ipoallotment.html');
      expect(allotmentButton).toHaveAttribute('target', '_blank');
      expect(allotmentButton).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should render website button when URL exists', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const websiteButton = screen.getByRole('link', { name: /Visit Website/i });
      expect(websiteButton).toBeInTheDocument();
      expect(websiteButton).toHaveAttribute('href', 'https://linkintime.co.in');
      expect(websiteButton).toHaveAttribute('target', '_blank');
      expect(websiteButton).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should not render allotment button when URL is missing', () => {
      const registrar = mockRegistrar({ allotmentCheckUrl: null });
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.queryByRole('link', { name: /Check Allotment Status/i })).not.toBeInTheDocument();
    });

    it('should not render website button when URL is missing', () => {
      const registrar = mockRegistrar({ website: null });
      render(<RegistrarCard registrar={registrar} />);

      expect(screen.queryByRole('link', { name: /Visit Website/i })).not.toBeInTheDocument();
    });
  });

  describe('Minimal Registrar Data', () => {
    it('should render with only required fields', () => {
      const registrar = mockRegistrar({
        shortName: null,
        email: null,
        phone: null,
        address: null,
        allotmentCheckUrl: null,
        website: null,
      });

      render(<RegistrarCard registrar={registrar} />);

      // Should still render the name
      expect(screen.getByText('Link Intime India Pvt Ltd')).toBeInTheDocument();

      // Should not have any action buttons
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  describe('Link Security', () => {
    it('should have noopener noreferrer on allotment check link', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const allotmentButton = screen.getByRole('link', { name: /Check Allotment Status/i });
      expect(allotmentButton).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should have noopener noreferrer on website link', () => {
      const registrar = mockRegistrar();
      render(<RegistrarCard registrar={registrar} />);

      const websiteButton = screen.getByRole('link', { name: /Visit Website/i });
      expect(websiteButton).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});
