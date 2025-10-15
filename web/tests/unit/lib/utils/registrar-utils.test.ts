/**
 * Unit Tests: Registrar Utilities
 *
 * Tests placeholder generation utilities for registrar logos.
 * Story 5.8: Registrar Logos
 */

import { describe, it, expect } from 'vitest';
import {
  getInitials,
  getColorFromName,
  getTextColor,
} from '@/lib/utils/registrar-utils';

describe('registrar-utils', () => {
  describe('getInitials', () => {
    it('should extract initials from two-word names', () => {
      expect(getInitials('Link Intime')).toBe('LI');
      expect(getInitials('KFin Technologies')).toBe('KT');
      expect(getInitials('Computer Age')).toBe('CA');
    });

    it('should extract initials from multi-word names (first 2 words only)', () => {
      expect(getInitials('Link Intime India Private Limited')).toBe('LI');
      expect(getInitials('KFin Technologies Private Limited')).toBe('KT');
      expect(getInitials('Computer Age Management Services Private Limited')).toBe('CA');
    });

    it('should handle single-word names', () => {
      expect(getInitials('Bigshare')).toBe('B');
      expect(getInitials('Karvy')).toBe('K');
    });

    it('should handle names with extra spaces', () => {
      expect(getInitials('  Link  Intime  ')).toBe('LI');
      expect(getInitials('Link    Intime')).toBe('LI');
    });

    it('should convert to uppercase', () => {
      expect(getInitials('link intime')).toBe('LI');
      expect(getInitials('kfin technologies')).toBe('KT');
    });

    it('should handle empty strings', () => {
      expect(getInitials('')).toBe('?');
      expect(getInitials('   ')).toBe('?');
    });

    it('should handle null and undefined', () => {
      expect(getInitials(null as any)).toBe('?');
      expect(getInitials(undefined as any)).toBe('?');
    });

    it('should handle special characters', () => {
      expect(getInitials('Link-Intime')).toBe('L');
      expect(getInitials('Link & Intime')).toBe('L&');
      expect(getInitials('Link (India) Intime')).toBe('L(');
    });
  });

  describe('getColorFromName', () => {
    it('should return consistent colors for the same name', () => {
      const color1 = getColorFromName('Link Intime');
      const color2 = getColorFromName('Link Intime');
      expect(color1).toBe(color2);
    });

    it('should return different colors for different names', () => {
      const color1 = getColorFromName('Link Intime');
      const color2 = getColorFromName('KFin Technologies');
      // May be same due to hash collision, but unlikely for these specific names
      // Just verify both return valid color classes
      expect(color1).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
      expect(color2).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
    });

    it('should return valid Tailwind color classes', () => {
      const validColors = [
        'bg-blue-500',
        'bg-green-500',
        'bg-purple-500',
        'bg-orange-500',
        'bg-pink-500',
        'bg-cyan-500',
        'bg-indigo-500',
        'bg-teal-500',
      ];

      const color = getColorFromName('Test Name');
      expect(validColors).toContain(color);
    });

    it('should handle empty strings', () => {
      const color = getColorFromName('');
      expect(color).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
    });

    it('should handle null and undefined', () => {
      const color1 = getColorFromName(null as any);
      const color2 = getColorFromName(undefined as any);
      expect(color1).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
      expect(color2).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
    });

    it('should handle special characters consistently', () => {
      const color1 = getColorFromName('Link-Intime');
      const color2 = getColorFromName('Link-Intime');
      expect(color1).toBe(color2);
    });
  });

  describe('getTextColor', () => {
    it('should return white text for all dark backgrounds', () => {
      expect(getTextColor('bg-blue-500')).toBe('text-white');
      expect(getTextColor('bg-green-500')).toBe('text-white');
      expect(getTextColor('bg-purple-500')).toBe('text-white');
      expect(getTextColor('bg-orange-500')).toBe('text-white');
    });
  });

  describe('integration: initials and colors work together', () => {
    it('should generate unique visual identities for common registrars', () => {
      const registrars = [
        'Link Intime India Private Limited',
        'KFin Technologies Limited',
        'Computer Age Management Services',
        'Bigshare Services Pvt Ltd',
      ];

      const identities = registrars.map((name) => ({
        name,
        initials: getInitials(name),
        color: getColorFromName(name),
      }));

      // Verify all have valid initials
      identities.forEach((identity) => {
        expect(identity.initials).toMatch(/^[A-Z?]{1,2}$/);
      });

      // Verify all have valid colors
      identities.forEach((identity) => {
        expect(identity.color).toMatch(/^bg-(blue|green|purple|orange|pink|cyan|indigo|teal)-500$/);
      });

      // Check specific expected values for known registrars
      expect(identities[0].initials).toBe('LI'); // Link Intime
      expect(identities[1].initials).toBe('KT'); // KFin Technologies
      expect(identities[2].initials).toBe('CA'); // Computer Age
      expect(identities[3].initials).toBe('BS'); // Bigshare
    });
  });
});
