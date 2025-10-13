import { describe, it, expect, expectTypeOf } from 'vitest';
import type {
  IPO,
  NewIPO,
  Subscription,
  GMPRecord,
  FinancialData,
  Document,
  ListingPerformance,
  MarketHoliday,
  Registrar,
  PeerCompany,
  BrokerAffiliate,
  IPOCategory,
  IPOStatus,
  DocumentType,
  Exchange,
  HolidayType,
  FinancialStatementType,
} from '../../../lib/db/types';
import { DEFAULT_HISTORICAL_FIELDS } from '../../../lib/db/types';

describe('Database Types', () => {
  describe('IPO Types', () => {
    it('should have correct IPO select type', () => {
      const mockIPO: IPO = {
        ...DEFAULT_HISTORICAL_FIELDS,
        id: '123e4567-e89b-12d3-a456-426614174000',
        companyName: 'Test Company',
        slug: 'test-company',
        category: 'MAINBOARD',
        sector: 'Technology',
        issueSize: '100.00',
        priceRangeMin: 100,
        priceRangeMax: 120,
        lotSize: 100,
        status: 'UPCOMING',
        openDate: '2025-01-01',
        closeDate: '2025-01-03',
        allotmentDate: null,
        listingDate: null,
        companyDescription: 'Test description',
        faceValue: 10,
        listingExchanges: ['NSE', 'BSE'],
        registrar: 'Test Registrar',
        registrarId: null,
        leadManagers: ['Manager 1'],
        rating: 4,
        ratingRationale: 'Good fundamentals',
        ratingOverride: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScrapedAt: null,
      };

      expect(mockIPO).toBeDefined();
      expectTypeOf(mockIPO.id).toBeString();
      expectTypeOf(mockIPO.category).toMatchTypeOf<IPOCategory>();
      expectTypeOf(mockIPO.status).toMatchTypeOf<IPOStatus>();
    });

    it('should have correct NewIPO insert type', () => {
      const mockNewIPO: NewIPO = {
        companyName: 'New Company',
        slug: 'new-company',
        category: 'SME',
        status: 'UPCOMING',
      };

      expect(mockNewIPO).toBeDefined();
      expectTypeOf(mockNewIPO.companyName).toBeString();
    });
  });

  describe('Subscription Types', () => {
    it('should have correct Subscription type', () => {
      const mockSubscription: Subscription = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date(),
        qibSubscription: '2.50',
        niiSubscription: '3.75',
        retailSubscription: '1.25',
        totalSubscription: '7.50',
        employeeSubscription: null,
        othersSubscription: null,
        anchorInvestorSubscription: null,
        retailHNISubscription: null,
        retailOthersSubscription: null,
        bNIISubscription: null,
        sNIISubscription: null,
        totalApplications: 1000,
        totalSharesBid: 50000,
        sharesOffered: 10000,
      };

      expect(mockSubscription).toBeDefined();
      expectTypeOf(mockSubscription.ipoId).toBeString();
    });
  });

  describe('GMP Record Types', () => {
    it('should have correct GMPRecord type with enhanced fields', () => {
      const mockGMPRecord: GMPRecord = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date(),
        gmp: 50,
        expectedListingPrice: 150,
        subjectRate: 20,
        kostakRate: 15,
        saudaDetails: 'Active trading',
        source: 'Market Source',
      };

      expect(mockGMPRecord).toBeDefined();
      expectTypeOf(mockGMPRecord.gmp).toBeNumber();
      expectTypeOf(mockGMPRecord.subjectRate).toEqualTypeOf<number | null>();
    });
  });

  describe('Financial Data Types', () => {
    it('should have correct FinancialData type', () => {
      const mockFinancialData: FinancialData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        revenueFy2022: '100.00',
        revenueFy2023: '120.00',
        revenueFy2024: '150.00',
        profitFy2022: '10.00',
        profitFy2023: '15.00',
        profitFy2024: '20.00',
        netWorth: '500.00',
        peRatio: '15.50',
        eps: '12.00',
        roe: '18.00',
        debtToEquity: '0.50',
        reservesAndSurplus: '200.00',
        totalAssets: '1000.00',
        totalBorrowing: '100.00',
      };

      expect(mockFinancialData).toBeDefined();
      expectTypeOf(mockFinancialData.ipoId).toBeString();
    });
  });

  describe('Document Types', () => {
    it('should have correct Document type', () => {
      const mockDocument: Document = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'DRHP',
        title: 'Draft Prospectus',
        url: 'https://example.com/drhp.pdf',
        fileSize: 1024000,
        uploadedAt: new Date(),
        exchange: 'NSE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockDocument).toBeDefined();
      expectTypeOf(mockDocument.type).toMatchTypeOf<DocumentType>();
    });
  });

  describe('Listing Performance Types', () => {
    it('should have correct ListingPerformance type', () => {
      const mockListingPerformance: ListingPerformance = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 150,
        issuePrice: 100,
        listingGainPercent: '50.00',
        currentPrice: 160,
        currentPriceBSE: 158,
        currentPriceNSE: 162,
        currentGainPercent: '60.00',
        lastUpdated: new Date(),
      };

      expect(mockListingPerformance).toBeDefined();
      expectTypeOf(mockListingPerformance.listingPrice).toBeNumber();
      expectTypeOf(mockListingPerformance.currentPriceBSE).toEqualTypeOf<number | null>();
      expectTypeOf(mockListingPerformance.currentPriceNSE).toEqualTypeOf<number | null>();
    });
  });

  describe('Market Holiday Types', () => {
    it('should have correct MarketHoliday type', () => {
      const mockHoliday: MarketHoliday = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        date: '2025-01-26',
        description: 'Republic Day',
        exchange: 'BOTH',
        type: 'TRADING',
        year: 2025,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockHoliday).toBeDefined();
      expectTypeOf(mockHoliday.exchange).toMatchTypeOf<Exchange>();
      expectTypeOf(mockHoliday.type).toMatchTypeOf<HolidayType>();
    });
  });

  describe('Registrar Types', () => {
    it('should have correct Registrar type', () => {
      const mockRegistrar: Registrar = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Link Intime India Pvt Ltd',
        shortName: 'Link Intime',
        email: 'ipo@linkintime.co.in',
        phone: '+91-22-49186000',
        website: 'https://www.linkintime.co.in',
        allotmentCheckUrl: 'https://linkintime.co.in/ipo-status',
        address: 'Mumbai Office',
        logoUrl: null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockRegistrar).toBeDefined();
      expectTypeOf(mockRegistrar.active).toBeBoolean();
    });
  });

  describe('Peer Company Types', () => {
    it('should have correct PeerCompany type', () => {
      const mockPeerCompany: PeerCompany = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        companyName: 'Peer Company Ltd',
        sector: 'Technology',
        isListed: true,
        peRatio: '18.50',
        eps: '15.00',
        dilutedEps: '14.50',
        ronw: '20.00',
        nav: '100.00',
        pbvRatio: '2.50',
        financialStatementType: 'CONSOLIDATED',
        dataSource: 'NSE',
        lastUpdated: new Date(),
        createdAt: new Date(),
      };

      expect(mockPeerCompany).toBeDefined();
      expectTypeOf(mockPeerCompany.isListed).toBeBoolean();
      expectTypeOf(mockPeerCompany.financialStatementType).toEqualTypeOf<
        FinancialStatementType | null
      >();
    });
  });

  describe('Broker Affiliate Types', () => {
    it('should have correct BrokerAffiliate type', () => {
      const mockBrokerAffiliate: BrokerAffiliate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        brokerName: 'Zerodha',
        brokerLogo: 'https://example.com/zerodha-logo.png',
        affiliateUrl: 'https://zerodha.com/open-account',
        displayText: 'Open Demat Account',
        active: true,
        displayOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(mockBrokerAffiliate).toBeDefined();
      expectTypeOf(mockBrokerAffiliate.displayOrder).toBeNumber();
    });
  });

  describe('Enum Types', () => {
    it('should have correct enum type definitions', () => {
      expectTypeOf<IPOCategory>().toMatchTypeOf<
        'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | 'FPO'
      >();
      expectTypeOf<IPOStatus>().toMatchTypeOf<
        'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED'
      >();
      expectTypeOf<DocumentType>().toMatchTypeOf<
        'DRHP' | 'RHP' | 'PROSPECTUS' | 'ADDENDUM'
      >();
      expectTypeOf<Exchange>().toMatchTypeOf<'NSE' | 'BSE' | 'BOTH'>();
      expectTypeOf<HolidayType>().toMatchTypeOf<'TRADING' | 'SETTLEMENT' | 'BOTH'>();
      expectTypeOf<FinancialStatementType>().toMatchTypeOf<
        'CONSOLIDATED' | 'STANDALONE'
      >();
    });
  });
});
