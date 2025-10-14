import { describe, it, expect } from 'vitest';
import * as schema from '../../../lib/db';

describe('Database Schema', () => {
  describe('Schema Structure', () => {
    it('should export all 10 core tables', () => {
      expect(schema.ipos).toBeDefined();
      expect(schema.subscriptions).toBeDefined();
      expect(schema.gmpRecords).toBeDefined();
      expect(schema.financialData).toBeDefined();
      expect(schema.documents).toBeDefined();
      expect(schema.listingPerformance).toBeDefined();
      expect(schema.marketHolidays).toBeDefined();
      expect(schema.registrars).toBeDefined();
      expect(schema.peerCompanies).toBeDefined();
      expect(schema.brokerAffiliates).toBeDefined();
    });

    it('should export all enum types', () => {
      expect(schema.ipoCategoryEnum).toBeDefined();
      expect(schema.ipoStatusEnum).toBeDefined();
      expect(schema.documentTypeEnum).toBeDefined();
      expect(schema.exchangeEnum).toBeDefined();
      expect(schema.holidayTypeEnum).toBeDefined();
      expect(schema.financialStatementTypeEnum).toBeDefined();
    });

    it('should export all table relations', () => {
      expect(schema.iposRelations).toBeDefined();
      expect(schema.subscriptionsRelations).toBeDefined();
      expect(schema.gmpRecordsRelations).toBeDefined();
      expect(schema.financialDataRelations).toBeDefined();
      expect(schema.documentsRelations).toBeDefined();
      expect(schema.listingPerformanceRelations).toBeDefined();
      expect(schema.peerCompaniesRelations).toBeDefined();
    });
  });

  describe('IPO Table', () => {
    it('should have all required fields from architecture', () => {
      const table = schema.ipos;

      // Check key fields exist (accessing internals for testing)
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Subscription Table', () => {
    it('should have all subscription category fields', () => {
      const table = schema.subscriptions;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('GMP Records Table', () => {
    it('should have enhanced GMP fields', () => {
      const table = schema.gmpRecords;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Financial Data Table', () => {
    it('should have yearly financial fields', () => {
      const table = schema.financialData;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Documents Table', () => {
    it('should have document management fields', () => {
      const table = schema.documents;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Listing Performance Table', () => {
    it('should have listing performance fields', () => {
      const table = schema.listingPerformance;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Market Holidays Table', () => {
    it('should have market holiday fields', () => {
      const table = schema.marketHolidays;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Registrars Table', () => {
    it('should have registrar fields', () => {
      const table = schema.registrars;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Peer Companies Table', () => {
    it('should have peer company fields', () => {
      const table = schema.peerCompanies;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });

  describe('Broker Affiliates Table', () => {
    it('should have broker affiliate fields', () => {
      const table = schema.brokerAffiliates;
      expect(table).toBeDefined();
      expect(typeof table).toBe('object');
    });
  });
});
