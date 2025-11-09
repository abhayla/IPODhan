/**
 * Field Label Mapping System for Dynamic Admin
 *
 * Maps database field names to human-readable labels with descriptions,
 * tooltips, and units. Uses NSE/SEBI standard terminology.
 *
 * Part of Day 3: Admin Consolidation Enhancement
 * Created: 2025-11-09
 *
 * Architecture:
 * - Provides user-friendly labels for all database fields
 * - Supports categorization for grouped display
 * - Includes tooltips with regulatory references where applicable
 * - Defines units for numeric fields (₹, %, shares, etc.)
 *
 * Reference: docs/16-database/screen-table-database-field-mapping.md
 */

export interface FieldLabelConfig {
  label: string;
  description?: string;
  category?: string;
  tooltip?: string;
  placeholder?: string;
  unit?: string; // e.g., "₹", "%", "shares", "x"
  helpText?: string; // Additional inline help text
}

/**
 * Field labels organized by table name
 * Comprehensive mapping for all 13 database tables
 */
export const fieldLabels: Record<string, Record<string, FieldLabelConfig>> = {
  // ========================================
  // TABLE 1: IPOs (Core Entity)
  // ========================================
  ipos: {
    // Basic Information
    companyName: {
      label: 'Company Name',
      description: 'Legal name of the company as per Registrar of Companies',
      category: 'Basic Information',
      tooltip: 'Full legal name including Ltd/Pvt Ltd/Inc suffix',
      placeholder: 'e.g., ABC Corporation Limited',
    },
    slug: {
      label: 'URL Slug',
      description: 'URL-friendly identifier for the IPO',
      category: 'Technical',
      tooltip: 'Auto-generated from company name, used in URLs',
      placeholder: 'abc-corporation-ltd',
    },
    symbol: {
      label: 'Stock Symbol',
      description: 'Trading symbol on stock exchange',
      category: 'Basic Information',
      tooltip: 'Ticker symbol assigned by NSE/BSE (e.g., TCS, INFY)',
      placeholder: 'e.g., RELIANCE',
    },
    isin: {
      label: 'ISIN',
      description: 'International Securities Identification Number',
      category: 'Basic Information',
      tooltip: '12-character alphanumeric code that uniquely identifies a security',
      placeholder: 'e.g., INE467B01029',
    },
    segment: {
      label: 'Exchange Segment',
      description: 'Market segment where IPO will be listed',
      category: 'Basic Information',
      tooltip: 'MAINBOARD for large companies (₹10+ crores), SME for smaller companies',
    },
    offeringType: {
      label: 'Offering Type',
      description: 'Type of public offering',
      category: 'Basic Information',
      tooltip: 'IPO = Initial Public Offering, FPO = Follow-on, RIGHTS = Rights Issue, etc.',
    },
    sector: {
      label: 'Industry Sector',
      description: 'Business sector or industry',
      category: 'Basic Information',
      tooltip: 'Primary business sector (e.g., IT, Banking, Pharmaceuticals)',
      placeholder: 'e.g., Information Technology',
    },
    status: {
      label: 'IPO Status',
      description: 'Current status of the IPO',
      category: 'Basic Information',
      tooltip: 'UPCOMING = Not yet open, OPEN = Currently accepting bids, CLOSED = Bidding ended, LISTED = Trading live',
    },

    // Pricing & Size
    issueSize: {
      label: 'Issue Size',
      description: 'Total size of the public offering',
      category: 'Pricing & Size',
      tooltip: 'Total amount to be raised through the IPO',
      unit: '₹ Crores',
      placeholder: 'e.g., 5000',
    },
    priceRangeMin: {
      label: 'Price Band - Lower',
      description: 'Minimum price per share (floor price)',
      category: 'Pricing & Size',
      tooltip: 'Retail investors can bid at cut-off or any price within the band',
      unit: '₹',
      placeholder: 'e.g., 100',
    },
    priceRangeMax: {
      label: 'Price Band - Upper',
      description: 'Maximum price per share (cap price)',
      category: 'Pricing & Size',
      tooltip: 'Final issue price determined within this range after book building',
      unit: '₹',
      placeholder: 'e.g., 105',
    },
    faceValue: {
      label: 'Face Value',
      description: 'Nominal value of each share',
      category: 'Pricing & Size',
      tooltip: 'Par value printed on share certificate, typically ₹1, ₹2, ₹5, or ₹10',
      unit: '₹',
      placeholder: 'e.g., 10',
    },
    lotSize: {
      label: 'Lot Size',
      description: 'Minimum shares per application',
      category: 'Subscription Details',
      tooltip: 'Applications must be in multiples of this lot size. SEBI requires minimum ₹10,000-15,000 application value',
      unit: 'shares',
      placeholder: 'e.g., 125',
    },

    // Important Dates
    openDate: {
      label: 'IPO Open Date',
      description: 'Start date for bidding',
      category: 'Important Dates',
      tooltip: 'First day when retail and institutional investors can submit applications',
    },
    closeDate: {
      label: 'IPO Close Date',
      description: 'Last date for bidding',
      category: 'Important Dates',
      tooltip: 'Final day to submit IPO applications, typically 3 working days after open date',
    },
    allotmentDate: {
      label: 'Allotment Date',
      description: 'Date when shares are allocated',
      category: 'Important Dates',
      tooltip: 'Date on which successful applicants receive share allotment',
    },
    listingDate: {
      label: 'Listing Date',
      description: 'Date when trading begins',
      category: 'Important Dates',
      tooltip: 'First day when shares trade on stock exchange',
    },

    // Company Details
    companyDescription: {
      label: 'Business Description',
      description: 'Overview of company operations',
      category: 'Company Details',
      tooltip: 'Brief description of business model, products, services',
      placeholder: 'Enter company business overview...',
    },
    listingExchanges: {
      label: 'Listing Exchanges',
      description: 'Stock exchanges where IPO will list',
      category: 'Basic Information',
      tooltip: 'NSE = National Stock Exchange, BSE = Bombay Stock Exchange, or BOTH',
    },

    // Intermediaries
    registrar: {
      label: 'Registrar Name',
      description: 'Registrar managing the IPO',
      category: 'Intermediaries',
      tooltip: 'Registrar and Transfer Agent (RTA) handling applications and allotment',
      placeholder: 'e.g., Link Intime India Private Limited',
    },
    registrarId: {
      label: 'Registrar',
      description: 'Linked registrar entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to registrars table',
    },
    leadManagers: {
      label: 'Lead Managers',
      description: 'Book running lead managers',
      category: 'Intermediaries',
      tooltip: 'Investment banks managing the IPO process (BRLMs)',
    },

    // Rating & Analysis
    rating: {
      label: 'IPODhan Rating',
      description: 'Platform rating score',
      category: 'Analysis',
      tooltip: 'IPODhan proprietary rating (1-5 stars) based on financials, valuation, and demand',
      unit: '/ 5',
      placeholder: 'e.g., 4',
    },
    ratingRationale: {
      label: 'Rating Rationale',
      description: 'Explanation of rating',
      category: 'Analysis',
      tooltip: 'Detailed explanation of why the IPO received this rating',
      placeholder: 'Enter rating justification...',
    },
    ratingOverride: {
      label: 'Manual Rating Override',
      description: 'Admin override flag',
      category: 'Technical',
      tooltip: 'Set to true if rating was manually adjusted by admin (overrides algorithm)',
    },

    // Historical Performance Data (Story 7.10)
    subscriptionRetail: {
      label: 'Retail Subscription',
      description: 'Retail investor subscription multiple',
      category: 'Subscription Data',
      tooltip: 'Times oversubscribed by retail investors (individuals)',
      unit: 'x',
      placeholder: 'e.g., 2.5',
    },
    subscriptionHni: {
      label: 'HNI Subscription',
      description: 'High Net-worth Individual subscription',
      category: 'Subscription Data',
      tooltip: 'Times oversubscribed by HNI category (NII)',
      unit: 'x',
      placeholder: 'e.g., 8.3',
    },
    subscriptionQib: {
      label: 'QIB Subscription',
      description: 'Qualified Institutional Buyer subscription',
      category: 'Subscription Data',
      tooltip: 'Times oversubscribed by institutional investors (mutual funds, banks, FIIs)',
      unit: 'x',
      placeholder: 'e.g., 12.5',
    },
    subscriptionTotal: {
      label: 'Total Subscription',
      description: 'Overall subscription multiple',
      category: 'Subscription Data',
      tooltip: 'Total times oversubscribed across all categories',
      unit: 'x',
      placeholder: 'e.g., 6.7',
    },

    // GMP (Grey Market Premium) Data
    gmpPrice: {
      label: 'GMP (Grey Market Premium)',
      description: 'Current grey market premium',
      category: 'Grey Market',
      tooltip: 'Premium/discount at which shares are trading in grey market (unofficial market before listing)',
      unit: '₹',
      placeholder: 'e.g., 50',
    },
    gmpPercentageHistorical: {
      label: 'GMP Percentage',
      description: 'GMP as percentage of issue price',
      category: 'Grey Market',
      tooltip: 'GMP as percentage of upper price band',
      unit: '%',
      placeholder: 'e.g., 25.5',
    },
    gmpUpdatedAtHistorical: {
      label: 'GMP Last Updated',
      description: 'Last GMP update timestamp',
      category: 'Grey Market',
      tooltip: 'When was the GMP last updated from Chittorgarh/other sources',
    },

    // Listing Performance
    listingPriceHistorical: {
      label: 'Listing Price',
      description: 'Opening price on listing day',
      category: 'Listing Performance',
      tooltip: 'Price at which stock opened on first trading day',
      unit: '₹',
      placeholder: 'e.g., 120',
    },
    listingGainPercentage: {
      label: 'Listing Day Gain',
      description: 'Return on listing day',
      category: 'Listing Performance',
      tooltip: 'Percentage gain/loss on listing day compared to issue price',
      unit: '%',
      placeholder: 'e.g., 15.5',
    },
    listingGainAmount: {
      label: 'Listing Gain Amount',
      description: 'Absolute gain on listing',
      category: 'Listing Performance',
      tooltip: 'Rupee gain/loss per share on listing day',
      unit: '₹',
      placeholder: 'e.g., 20',
    },
    listingDateHistorical: {
      label: 'Listed On',
      description: 'Actual listing date',
      category: 'Important Dates',
      tooltip: 'Date when stock started trading on exchange',
    },

    // Current Price Tracking
    currentPrice: {
      label: 'Current Market Price',
      description: 'Latest trading price',
      category: 'Current Performance',
      tooltip: 'Most recent market price (updated periodically)',
      unit: '₹',
      placeholder: 'e.g., 150',
    },
    currentGainPercentage: {
      label: 'Current Return',
      description: 'Overall return since listing',
      category: 'Current Performance',
      tooltip: 'Percentage gain/loss from issue price to current price',
      unit: '%',
      placeholder: 'e.g., 45.5',
    },
    currentGainAmount: {
      label: 'Current Gain Amount',
      description: 'Absolute gain since issue',
      category: 'Current Performance',
      tooltip: 'Rupee gain/loss per share from issue price',
      unit: '₹',
      placeholder: 'e.g., 50',
    },
    currentPriceUpdatedAt: {
      label: 'Price Last Updated',
      description: 'Last price update timestamp',
      category: 'Current Performance',
      tooltip: 'When was the current price last refreshed',
    },

    // Metadata & Scraper Management
    lastScrapedAt: {
      label: 'Last Scraped',
      description: 'Last successful data scrape',
      category: 'Metadata',
      tooltip: 'Timestamp of last successful scraper run for this IPO',
    },
    historicalDataSource: {
      label: 'Historical Data Source',
      description: 'Source of historical data',
      category: 'Metadata',
      tooltip: 'Where historical performance data was obtained (e.g., Chittorgarh)',
      placeholder: 'e.g., Chittorgarh',
    },
    historicalDataScrapedAt: {
      label: 'Historical Data Scraped',
      description: 'Last historical data scrape',
      category: 'Metadata',
      tooltip: 'When historical performance data was last updated',
    },
    scraperLocked: {
      label: 'Scraper Lock',
      description: 'IPO-level protection from scraper',
      category: 'Data Management',
      tooltip: 'Master lock - prevents scraper from updating ANY field for this IPO',
    },
    scraperLockNote: {
      label: 'Lock Reason',
      description: 'Why IPO is locked',
      category: 'Data Management',
      tooltip: 'Admin note explaining why this IPO is protected from scraper updates',
      placeholder: 'Enter reason for locking...',
    },
    lastManualEditAt: {
      label: 'Last Manual Edit',
      description: 'Last admin edit timestamp',
      category: 'Metadata',
      tooltip: 'When was this IPO last manually edited by an admin',
    },

    // IPO Objectives (Story 11.13)
    objectives: {
      label: 'IPO Objectives',
      description: 'Use of proceeds',
      category: 'Company Details',
      tooltip: 'How the company plans to use funds raised from IPO',
      placeholder: 'Enter IPO objectives JSON...',
    },

    // Timestamps
    createdAt: {
      label: 'Created At',
      description: 'Record creation timestamp',
      category: 'Metadata',
      tooltip: 'When this IPO was first added to database',
    },
    updatedAt: {
      label: 'Last Updated',
      description: 'Record update timestamp',
      category: 'Metadata',
      tooltip: 'When this IPO was last modified',
    },
  },

  // ========================================
  // TABLE 2: Financial Data
  // ========================================
  financialData: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },

    // Revenue Data
    revenueFy2022: {
      label: 'Revenue FY 2022',
      description: 'Total revenue for fiscal year 2022',
      category: 'Revenue',
      tooltip: 'Annual revenue from operations',
      unit: '₹ Crores',
      placeholder: 'e.g., 1250.50',
    },
    revenueFy2023: {
      label: 'Revenue FY 2023',
      description: 'Total revenue for fiscal year 2023',
      category: 'Revenue',
      tooltip: 'Annual revenue from operations',
      unit: '₹ Crores',
      placeholder: 'e.g., 1500.75',
    },
    revenueFy2024: {
      label: 'Revenue FY 2024',
      description: 'Total revenue for fiscal year 2024',
      category: 'Revenue',
      tooltip: 'Annual revenue from operations',
      unit: '₹ Crores',
      placeholder: 'e.g., 1800.00',
    },

    // Profit Data
    profitFy2022: {
      label: 'Net Profit FY 2022',
      description: 'Net profit after tax for FY 2022',
      category: 'Profitability',
      tooltip: 'Profit After Tax (PAT) - can be negative for losses',
      unit: '₹ Crores',
      placeholder: 'e.g., 125.50',
    },
    profitFy2023: {
      label: 'Net Profit FY 2023',
      description: 'Net profit after tax for FY 2023',
      category: 'Profitability',
      tooltip: 'Profit After Tax (PAT) - can be negative for losses',
      unit: '₹ Crores',
      placeholder: 'e.g., 150.75',
    },
    profitFy2024: {
      label: 'Net Profit FY 2024',
      description: 'Net profit after tax for FY 2024',
      category: 'Profitability',
      tooltip: 'Profit After Tax (PAT) - can be negative for losses',
      unit: '₹ Crores',
      placeholder: 'e.g., 180.00',
    },

    // Valuation Metrics
    eps: {
      label: 'EPS (Earnings Per Share)',
      description: 'Profit per share',
      category: 'Valuation Metrics',
      tooltip: 'Net Profit ÷ Total Outstanding Shares',
      unit: '₹',
      placeholder: 'e.g., 12.50',
    },
    peRatio: {
      label: 'P/E Ratio',
      description: 'Price-to-Earnings ratio',
      category: 'Valuation Metrics',
      tooltip: 'Market Price per Share ÷ EPS. Compare with industry median for valuation assessment',
      unit: 'x',
      placeholder: 'e.g., 25.5',
    },
    roe: {
      label: 'ROE (Return on Equity)',
      description: 'Profitability relative to equity',
      category: 'Profitability Metrics',
      tooltip: 'Net Profit ÷ Shareholders Equity × 100. Higher ROE indicates better profitability',
      unit: '%',
      placeholder: 'e.g., 18.5',
    },
    debtToEquity: {
      label: 'Debt-to-Equity Ratio',
      description: 'Leverage ratio',
      category: 'Financial Health',
      tooltip: 'Total Debt ÷ Total Equity. Lower is generally better (less leveraged)',
      unit: 'x',
      placeholder: 'e.g., 0.5',
    },
    netWorth: {
      label: 'Net Worth',
      description: 'Shareholders equity',
      category: 'Financial Health',
      tooltip: 'Total Assets - Total Liabilities. Must be positive for IPO eligibility',
      unit: '₹ Crores',
      placeholder: 'e.g., 500.00',
    },
    totalAssets: {
      label: 'Total Assets',
      description: 'Sum of all assets',
      category: 'Balance Sheet',
      tooltip: 'Current Assets + Fixed Assets + Investments',
      unit: '₹ Crores',
      placeholder: 'e.g., 1200.00',
    },
    totalBorrowing: {
      label: 'Total Borrowings',
      description: 'Total debt',
      category: 'Balance Sheet',
      tooltip: 'Short-term + Long-term debt',
      unit: '₹ Crores',
      placeholder: 'e.g., 250.00',
    },

    // Market Cap
    marketCap: {
      label: 'Market Capitalization',
      description: 'Total market value',
      category: 'Valuation Metrics',
      tooltip: 'Current Market Price × Total Outstanding Shares',
      unit: '₹ Crores',
      placeholder: 'e.g., 5000.00',
    },

    // Metadata
    financialStatementType: {
      label: 'Financial Statement Type',
      description: 'Consolidated or Standalone',
      category: 'Metadata',
      tooltip: 'CONSOLIDATED includes subsidiaries, STANDALONE is parent company only',
    },
    lastUpdated: {
      label: 'Last Updated',
      description: 'Record update timestamp',
      category: 'Metadata',
      tooltip: 'When this financial data was last modified',
    },
  },

  // ========================================
  // TABLE 3: Subscriptions (Time-series)
  // ========================================
  subscriptions: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    timestamp: {
      label: 'Subscription Timestamp',
      description: 'When subscription was recorded',
      category: 'Metadata',
      tooltip: 'Timestamp of subscription snapshot (updated multiple times during IPO period)',
    },

    // Main Categories
    qibSubscription: {
      label: 'QIB Subscription',
      description: 'Qualified Institutional Buyers',
      category: 'Subscription Categories',
      tooltip: 'Institutional investors (mutual funds, insurance, FIIs) - typically 50% of issue',
      unit: 'x',
      placeholder: 'e.g., 12.5',
    },
    niiSubscription: {
      label: 'NII Subscription',
      description: 'Non-Institutional Investors (HNI)',
      category: 'Subscription Categories',
      tooltip: 'High Networth Individuals (application > ₹2 lakhs) - typically 15% of issue',
      unit: 'x',
      placeholder: 'e.g., 8.3',
    },
    retailSubscription: {
      label: 'Retail Subscription',
      description: 'Retail Individual Investors',
      category: 'Subscription Categories',
      tooltip: 'Individual investors (application ≤ ₹2 lakhs) - typically 35% of issue',
      unit: 'x',
      placeholder: 'e.g., 2.5',
    },
    totalSubscription: {
      label: 'Total Subscription',
      description: 'Overall subscription multiple',
      category: 'Subscription Categories',
      tooltip: 'Times oversubscribed across all categories',
      unit: 'x',
      placeholder: 'e.g., 6.7',
    },
    employeeSubscription: {
      label: 'Employee Subscription',
      description: 'Company employees',
      category: 'Subscription Categories',
      tooltip: 'Employees of the issuing company (if employee quota offered)',
      unit: 'x',
      placeholder: 'e.g., 1.5',
    },
    othersSubscription: {
      label: 'Others Subscription',
      description: 'Other categories',
      category: 'Subscription Categories',
      tooltip: 'Shareholders, promoters, other special categories',
      unit: 'x',
      placeholder: 'e.g., 0.8',
    },

    // QIB Sub-categories
    qibFiiSubscription: {
      label: 'QIB - FII',
      description: 'Foreign Institutional Investors',
      category: 'QIB Breakdown',
      tooltip: 'Foreign institutions investing in Indian markets',
      unit: 'x',
    },
    qibDomesticFiSubscription: {
      label: 'QIB - Domestic FI',
      description: 'Domestic Financial Institutions',
      category: 'QIB Breakdown',
      tooltip: 'Indian banks, insurance companies',
      unit: 'x',
    },
    qibMutualFundSubscription: {
      label: 'QIB - Mutual Funds',
      description: 'Mutual Fund houses',
      category: 'QIB Breakdown',
      tooltip: 'Mutual fund companies',
      unit: 'x',
    },

    // Application Metrics
    totalApplications: {
      label: 'Total Applications',
      description: 'Number of bids received',
      category: 'Application Metrics',
      tooltip: 'Total number of applications across all categories',
      unit: 'applications',
      placeholder: 'e.g., 125000',
    },
    totalSharesBid: {
      label: 'Total Shares Bid',
      description: 'Total shares applied for',
      category: 'Application Metrics',
      tooltip: 'Total number of shares bid across all applications',
      unit: 'shares',
      placeholder: 'e.g., 50000000',
    },
    sharesOffered: {
      label: 'Shares Offered',
      description: 'Total shares available',
      category: 'Application Metrics',
      tooltip: 'Total number of shares available for subscription',
      unit: 'shares',
      placeholder: 'e.g., 10000000',
    },
  },

  // ========================================
  // TABLE 4: GMP Records (Time-series)
  // ========================================
  gmpRecords: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    gmpPrice: {
      label: 'GMP Price',
      description: 'Grey market premium amount',
      category: 'GMP Data',
      tooltip: 'Absolute premium/discount in rupees over issue price',
      unit: '₹',
      placeholder: 'e.g., 50',
    },
    gmpPercentage: {
      label: 'GMP Percentage',
      description: 'Premium as percentage',
      category: 'GMP Data',
      tooltip: 'GMP as percentage of upper price band',
      unit: '%',
      placeholder: 'e.g., 25.5',
    },
    estimatedListingPrice: {
      label: 'Expected Listing Price',
      description: 'Estimated listing price',
      category: 'GMP Data',
      tooltip: 'Issue Price + GMP = Expected listing price (unofficial estimate)',
      unit: '₹',
      placeholder: 'e.g., 150',
    },
    subject: {
      label: 'Subject/Source',
      description: 'GMP data subject',
      category: 'Metadata',
      tooltip: 'Subject line or source identifier from GMP provider',
    },
    source: {
      label: 'Data Source',
      description: 'Where GMP was sourced from',
      category: 'Metadata',
      tooltip: 'Source of GMP data (e.g., Chittorgarh, IPO Central)',
      placeholder: 'e.g., Chittorgarh',
    },
    recordedAt: {
      label: 'Recorded At',
      description: 'GMP snapshot timestamp',
      category: 'Metadata',
      tooltip: 'When this GMP value was recorded',
    },
  },

  // ========================================
  // TABLE 5: Documents
  // ========================================
  documents: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    title: {
      label: 'Document Title',
      description: 'Name of the document',
      category: 'Document Info',
      tooltip: 'Document name as provided by exchange/issuer',
      placeholder: 'e.g., Draft Red Herring Prospectus',
    },
    type: {
      label: 'Document Type',
      description: 'Category of document',
      category: 'Document Info',
      tooltip: 'DRHP = Draft Red Herring Prospectus, RHP = Red Herring Prospectus, PROSPECTUS = Final Prospectus',
    },
    url: {
      label: 'Download URL',
      description: 'Document file URL',
      category: 'Document Info',
      tooltip: 'Direct download link from NSE/BSE',
      placeholder: 'https://...',
    },
    fileSize: {
      label: 'File Size',
      description: 'Document size in bytes',
      category: 'Document Info',
      tooltip: 'Size of the PDF/document file',
      unit: 'bytes',
    },
    uploadedAt: {
      label: 'Upload Date',
      description: 'When document was published',
      category: 'Metadata',
      tooltip: 'Date when document was uploaded by issuer/exchange',
    },
  },

  // ========================================
  // TABLE 6: Listing Performance
  // ========================================
  listingPerformance: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    issuePrice: {
      label: 'Issue Price',
      description: 'Final IPO price per share',
      category: 'Pricing',
      tooltip: 'Price at which shares were allotted to investors',
      unit: '₹',
      placeholder: 'e.g., 100',
    },
    listingPrice: {
      label: 'Listing Price',
      description: 'Opening price on listing day',
      category: 'Listing Day',
      tooltip: 'Price at which stock opened trading on first day',
      unit: '₹',
      placeholder: 'e.g., 120',
    },
    listingGainPercent: {
      label: 'Listing Day Return',
      description: 'Gain/loss on listing',
      category: 'Listing Day',
      tooltip: '(Listing Price - Issue Price) ÷ Issue Price × 100',
      unit: '%',
      placeholder: 'e.g., 20.0',
    },
    currentPriceNse: {
      label: 'Current Price (NSE)',
      description: 'Latest NSE price',
      category: 'Current Performance',
      tooltip: 'Most recent trading price on National Stock Exchange',
      unit: '₹',
      placeholder: 'e.g., 150',
    },
    currentPriceBse: {
      label: 'Current Price (BSE)',
      description: 'Latest BSE price',
      category: 'Current Performance',
      tooltip: 'Most recent trading price on Bombay Stock Exchange',
      unit: '₹',
      placeholder: 'e.g., 149.50',
    },
    currentGainPercent: {
      label: 'Overall Return',
      description: 'Total return since issue',
      category: 'Current Performance',
      tooltip: '(Current Price - Issue Price) ÷ Issue Price × 100',
      unit: '%',
      placeholder: 'e.g., 50.0',
    },
    lastUpdated: {
      label: 'Last Updated',
      description: 'Price update timestamp',
      category: 'Metadata',
      tooltip: 'When current prices were last refreshed',
    },
  },

  // ========================================
  // TABLE 7: Registrars
  // ========================================
  registrars: {
    name: {
      label: 'Registrar Name',
      description: 'Name of the RTA',
      category: 'Basic Information',
      tooltip: 'Registrar and Transfer Agent company name',
      placeholder: 'e.g., Link Intime India Private Limited',
    },
    website: {
      label: 'Website URL',
      description: 'Official website',
      category: 'Contact Information',
      tooltip: 'Registrar company website',
      placeholder: 'https://...',
    },
    email: {
      label: 'Email Address',
      description: 'Contact email',
      category: 'Contact Information',
      tooltip: 'General inquiry email address',
      placeholder: 'info@registrar.com',
    },
    phone: {
      label: 'Phone Number',
      description: 'Contact phone',
      category: 'Contact Information',
      tooltip: 'Customer support phone number',
      placeholder: '+91-...',
    },
    address: {
      label: 'Registered Address',
      description: 'Office address',
      category: 'Contact Information',
      tooltip: 'Physical address of registrar office',
      placeholder: 'Enter full address...',
    },
  },

  // ========================================
  // TABLE 8: Peer Companies
  // ========================================
  peerCompanies: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    companyName: {
      label: 'Peer Company Name',
      description: 'Name of comparable company',
      category: 'Company Info',
      tooltip: 'Listed company in same sector for comparison',
      placeholder: 'e.g., TCS Limited',
    },
    peRatio: {
      label: 'P/E Ratio',
      description: 'Peer P/E ratio',
      category: 'Valuation',
      tooltip: 'Price-to-Earnings ratio for comparison',
      unit: 'x',
    },
    marketCap: {
      label: 'Market Cap',
      description: 'Peer market capitalization',
      category: 'Valuation',
      tooltip: 'Market cap for size comparison',
      unit: '₹ Crores',
    },
    roe: {
      label: 'ROE',
      description: 'Peer return on equity',
      category: 'Profitability',
      tooltip: 'ROE for profitability comparison',
      unit: '%',
    },
  },

  // ========================================
  // TABLE 9: IPO Reviews
  // ========================================
  ipoReviews: {
    ipoId: {
      label: 'IPO Reference',
      description: 'Linked IPO entity',
      category: 'Technical',
      tooltip: 'Foreign key reference to ipos table',
    },
    analyst: {
      label: 'Analyst/Source',
      description: 'Who published the review',
      category: 'Review Info',
      tooltip: 'Name of analyst or research firm',
      placeholder: 'e.g., Motilal Oswal',
    },
    recommendation: {
      label: 'Recommendation',
      description: 'Analyst recommendation',
      category: 'Review Info',
      tooltip: 'Subscribe, May Apply, Avoid, Not Recommended',
    },
    summary: {
      label: 'Review Summary',
      description: 'Brief review summary',
      category: 'Review Info',
      tooltip: 'Key points from analyst review',
      placeholder: 'Enter review summary...',
    },
    publishedAt: {
      label: 'Published Date',
      description: 'Review publication date',
      category: 'Metadata',
      tooltip: 'When the review was published',
    },
  },

  // ========================================
  // TABLE 10: Market Holidays
  // ========================================
  marketHolidays: {
    date: {
      label: 'Holiday Date',
      description: 'Date of market holiday',
      category: 'Holiday Info',
      tooltip: 'Date when market is closed',
    },
    occasion: {
      label: 'Occasion',
      description: 'Reason for holiday',
      category: 'Holiday Info',
      tooltip: 'Name of festival/holiday',
      placeholder: 'e.g., Diwali',
    },
    exchange: {
      label: 'Exchange',
      description: 'Which exchange is closed',
      category: 'Holiday Info',
      tooltip: 'NSE, BSE, or BOTH',
    },
    holidayType: {
      label: 'Holiday Type',
      description: 'Type of closure',
      category: 'Holiday Info',
      tooltip: 'TRADING = No trading, SETTLEMENT = Trading allowed but no settlement',
    },
  },
};

/**
 * Get field label configuration for a specific table and field
 * Returns fallback if no mapping exists
 *
 * @param tableName - Name of the database table
 * @param fieldName - Name of the field
 * @returns FieldLabelConfig with label and metadata
 */
export function getFieldLabel(
  tableName: string,
  fieldName: string
): FieldLabelConfig {
  const tableLabels = fieldLabels[tableName];

  if (tableLabels && tableLabels[fieldName]) {
    return tableLabels[fieldName];
  }

  // Fallback: Convert field name to title case
  const fallbackLabel = fieldName
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters
    .replace(/_/g, ' ') // Replace underscores
    .replace(/\b\w/g, (l) => l.toUpperCase()) // Capitalize first letter of each word
    .trim();

  return {
    label: fallbackLabel,
    category: 'Other',
  };
}

/**
 * Get all field labels for a specific table
 *
 * @param tableName - Name of the database table
 * @returns Record of field names to FieldLabelConfig
 */
export function getTableFieldLabels(
  tableName: string
): Record<string, FieldLabelConfig> {
  return fieldLabels[tableName] || {};
}

/**
 * Check if a table has field label mappings
 *
 * @param tableName - Name of the database table
 * @returns boolean indicating if mappings exist
 */
export function hasFieldLabels(tableName: string): boolean {
  return tableName in fieldLabels;
}

/**
 * Get all unique categories for a table's fields
 * Useful for grouping fields in the UI
 *
 * @param tableName - Name of the database table
 * @returns Array of unique category names
 */
export function getTableCategories(tableName: string): string[] {
  const tableConfig = fieldLabels[tableName];
  if (!tableConfig) return [];

  const categories = new Set<string>();
  Object.values(tableConfig).forEach((config) => {
    if (config.category) {
      categories.add(config.category);
    }
  });

  return Array.from(categories).sort();
}

/**
 * Get fields grouped by category for a table
 * Returns a map of category name to array of field names
 *
 * @param tableName - Name of the database table
 * @returns Record mapping category names to field names
 */
export function getFieldsByCategory(
  tableName: string
): Record<string, string[]> {
  const tableConfig = fieldLabels[tableName];
  if (!tableConfig) return {};

  const grouped: Record<string, string[]> = {};

  Object.entries(tableConfig).forEach(([fieldName, config]) => {
    const category = config.category || 'Other';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(fieldName);
  });

  return grouped;
}
