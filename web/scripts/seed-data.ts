/**
 * Seed Data Script for IPODhan
 *
 * Populates the database with realistic sample IPO data for development and testing.
 *
 * Features:
 * - Creates 20+ sample IPOs across all categories (MAINBOARD, SME, RIGHTS, NCD)
 * - Populates all relationships (financials, subscriptions, GMP, documents, listing performance)
 * - Idempotent (safe to run multiple times)
 * - Realistic data representative of actual IPO scenarios
 * - Clear progress logging
 *
 * Usage: npm run seed
 */

// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
const result = config({ path: envPath });

if (result.error) {
  console.error('Error loading .env.local:', result.error);
  process.exit(1);
}

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not found in environment variables');
  console.error('Tried loading from:', envPath);
  process.exit(1);
}

console.log('✓ Environment variables loaded successfully');
console.log('Database URL configured:', process.env.DATABASE_URL?.substring(0, 30) + '...');
console.log('Database credentials check:');
console.log('- HOST:', process.env.DATABASE_HOST);
console.log('- PORT:', process.env.DATABASE_PORT);
console.log('- NAME:', process.env.DATABASE_NAME);
console.log('- USER:', process.env.DATABASE_USER);
console.log('- PASSWORD:', process.env.DATABASE_PASSWORD ? '***SET***' : 'MISSING');

import type Redis from 'ioredis';
import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import {
  IPORepository,
  SubscriptionRepository,
  GMPRepository,
  FinancialDataRepository,
  DocumentRepository,
  ListingPerformanceRepository,
} from '@/lib/repositories';
import {
  ipos,
  registrars,
  marketHolidays,
  peerCompanies,
  brokerAffiliates,
} from '@/lib/db/schema';
import { count } from 'drizzle-orm';

// ==================== TYPES ====================

interface SeedIPOData {
  companyName: string;
  slug: string;
  category: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD';
  sector: string;
  issueSize: string;
  priceRangeMin: number;
  priceRangeMax: number;
  lotSize: number;
  status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  openDate: Date;
  closeDate: Date;
  allotmentDate: Date | null;
  listingDate: Date | null;
  companyDescription: string;
  faceValue: number;
  listingExchanges: ('NSE' | 'BSE')[];
  registrar: string;
  leadManagers: string[];
  rating: number;
  ratingRationale: string;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate relative date from today
 */
function getRelativeDate(daysFromToday: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date;
}

/**
 * Generate random number between min and max
 */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random decimal between min and max
 */
function randomDecimal(min: number, max: number, decimals: number = 2): string {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(decimals);
}

// ==================== SEED DATA DEFINITIONS ====================

const SAMPLE_IPOS: SeedIPOData[] = [
  // ===== MAINBOARD IPOs (10 companies) =====
  {
    companyName: 'TechVision India Ltd',
    slug: 'techvision-india-ipo',
    category: 'MAINBOARD',
    sector: 'Technology',
    issueSize: '1250.00',
    priceRangeMin: 280,
    priceRangeMax: 295,
    lotSize: 50,
    status: 'LISTED',
    openDate: getRelativeDate(-45),
    closeDate: getRelativeDate(-43),
    allotmentDate: getRelativeDate(-38),
    listingDate: getRelativeDate(-35),
    companyDescription: 'Leading provider of enterprise software solutions with focus on AI/ML integration, cloud services, and digital transformation. Operations across India, SEA, and Middle East.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['ICICI Securities', 'Kotak Mahindra Capital'],
    rating: 4,
    ratingRationale: 'Strong technology stack, experienced management, healthy order book, reasonable valuation. Minor concern on client concentration.',
  },
  {
    companyName: 'Pharma Wellness Ltd',
    slug: 'pharma-wellness-ipo',
    category: 'MAINBOARD',
    sector: 'Pharmaceuticals',
    issueSize: '890.50',
    priceRangeMin: 165,
    priceRangeMax: 175,
    lotSize: 85,
    status: 'LISTED',
    openDate: getRelativeDate(-30),
    closeDate: getRelativeDate(-28),
    allotmentDate: getRelativeDate(-23),
    listingDate: getRelativeDate(-20),
    companyDescription: 'Pharmaceutical company specializing in generic drugs, APIs, and formulations. Strong presence in domestic and export markets with WHO-GMP certified facilities.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Axis Capital', 'IIFL Securities'],
    rating: 5,
    ratingRationale: 'Excellent growth trajectory, diversified product portfolio, strong export revenues, healthy margins, zero debt. Highly recommended.',
  },
  {
    companyName: 'Metro Infrastructure Projects Ltd',
    slug: 'metro-infrastructure-ipo',
    category: 'MAINBOARD',
    sector: 'Infrastructure',
    issueSize: '2100.00',
    priceRangeMin: 420,
    priceRangeMax: 450,
    lotSize: 33,
    status: 'CLOSED',
    openDate: getRelativeDate(-5),
    closeDate: getRelativeDate(-3),
    allotmentDate: getRelativeDate(2),
    listingDate: getRelativeDate(5),
    companyDescription: 'Leading infrastructure development company focusing on metro rail projects, elevated corridors, and urban transportation systems. Marquee government contracts.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Karvy Computershare Pvt Ltd',
    leadManagers: ['SBI Capital Markets', 'JM Financial'],
    rating: 4,
    ratingRationale: 'Strong order book, government backing, experienced execution team. Working capital intensive nature is a concern.',
  },
  {
    companyName: 'AutoTech Components Ltd',
    slug: 'autotech-components-ipo',
    category: 'MAINBOARD',
    sector: 'Automobile',
    issueSize: '650.75',
    priceRangeMin: 220,
    priceRangeMax: 235,
    lotSize: 63,
    status: 'CLOSED',
    openDate: getRelativeDate(-3),
    closeDate: getRelativeDate(-1),
    allotmentDate: getRelativeDate(4),
    listingDate: getRelativeDate(7),
    companyDescription: 'Tier-1 auto component manufacturer supplying to major OEMs. Specializes in precision components, EV parts, and lightweight materials for automotive industry.',
    faceValue: 5,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['HDFC Bank', 'Nomura'],
    rating: 3,
    ratingRationale: 'Established player with good OEM relationships. Concerns on auto sector slowdown and transition to EV affecting demand.',
  },
  {
    companyName: 'GreenEnergy Solutions Ltd',
    slug: 'greenenergy-solutions-ipo',
    category: 'MAINBOARD',
    sector: 'Renewable Energy',
    issueSize: '1850.00',
    priceRangeMin: 380,
    priceRangeMax: 400,
    lotSize: 37,
    status: 'OPEN',
    openDate: getRelativeDate(-1),
    closeDate: getRelativeDate(1),
    allotmentDate: getRelativeDate(6),
    listingDate: getRelativeDate(9),
    companyDescription: 'Renewable energy company with solar and wind power generation assets totaling 2.5 GW. Long-term PPAs with state utilities ensuring stable revenue.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Morgan Stanley', 'Citigroup'],
    rating: 5,
    ratingRationale: 'Exceptional growth sector, strong asset base, long-term revenue visibility through PPAs. Government push for renewables is tailwind.',
  },
  {
    companyName: 'FinServe Digital Bank Ltd',
    slug: 'finserve-digital-bank-ipo',
    category: 'MAINBOARD',
    sector: 'Financial Services',
    issueSize: '3200.00',
    priceRangeMin: 550,
    priceRangeMax: 580,
    lotSize: 25,
    status: 'OPEN',
    openDate: getRelativeDate(0),
    closeDate: getRelativeDate(2),
    allotmentDate: getRelativeDate(7),
    listingDate: getRelativeDate(10),
    companyDescription: 'New-age digital bank offering retail and MSME lending, wealth management, and payment solutions. Technology-first approach with AI-driven underwriting.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Bigshare Services Pvt Ltd',
    leadManagers: ['Goldman Sachs', 'BofA Securities'],
    rating: 4,
    ratingRationale: 'Innovative business model, strong tech platform, capital adequacy. Asset quality and profitability need monitoring.',
  },
  {
    companyName: 'Luxury Hospitality Group Ltd',
    slug: 'luxury-hospitality-ipo',
    category: 'MAINBOARD',
    sector: 'Hospitality',
    issueSize: '980.00',
    priceRangeMin: 320,
    priceRangeMax: 340,
    lotSize: 44,
    status: 'OPEN',
    openDate: getRelativeDate(1),
    closeDate: getRelativeDate(3),
    allotmentDate: getRelativeDate(8),
    listingDate: getRelativeDate(11),
    companyDescription: 'Premium hospitality chain operating 45 hotels across tier-1 and tier-2 cities. Focus on business travel and luxury leisure segment.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Cameo Corporate Services Ltd',
    leadManagers: ['Edelweiss Financial', 'YES Securities'],
    rating: 3,
    ratingRationale: 'Recovering from pandemic impact, improving occupancy rates. High debt levels and sector cyclicality are concerns.',
  },
  {
    companyName: 'Advanced Manufacturing Systems Ltd',
    slug: 'advanced-manufacturing-ipo',
    category: 'MAINBOARD',
    sector: 'Manufacturing',
    issueSize: '1420.00',
    priceRangeMin: 455,
    priceRangeMax: 480,
    lotSize: 31,
    status: 'OPEN',
    openDate: getRelativeDate(2),
    closeDate: getRelativeDate(4),
    allotmentDate: getRelativeDate(9),
    listingDate: getRelativeDate(12),
    companyDescription: 'Industrial automation and robotics manufacturer serving automotive, electronics, and FMCG sectors. Advanced Industry 4.0 solutions provider.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['Jefferies India', 'CLSA India'],
    rating: 4,
    ratingRationale: 'High-growth automation segment, technology leadership, diversified client base. Capital intensive nature noted.',
  },
  {
    companyName: 'Urban Retail Chain Ltd',
    slug: 'urban-retail-chain-ipo',
    category: 'MAINBOARD',
    sector: 'Retail',
    issueSize: '725.00',
    priceRangeMin: 185,
    priceRangeMax: 195,
    lotSize: 76,
    status: 'UPCOMING',
    openDate: getRelativeDate(10),
    closeDate: getRelativeDate(12),
    allotmentDate: getRelativeDate(17),
    listingDate: getRelativeDate(20),
    companyDescription: 'Multi-format retail chain with 280 stores in fashion, lifestyle, and home categories. Strong omnichannel presence and private label portfolio.',
    faceValue: 5,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Motilal Oswal', 'IDFC Securities'],
    rating: 3,
    ratingRationale: 'Established brand, decent same-store growth. Intense competition and e-commerce disruption are headwinds.',
  },
  {
    companyName: 'Agro Food Processing Ltd',
    slug: 'agro-food-processing-ipo',
    category: 'MAINBOARD',
    sector: 'Food Processing',
    issueSize: '540.00',
    priceRangeMin: 140,
    priceRangeMax: 150,
    lotSize: 100,
    status: 'UPCOMING',
    openDate: getRelativeDate(15),
    closeDate: getRelativeDate(17),
    allotmentDate: getRelativeDate(22),
    listingDate: getRelativeDate(25),
    companyDescription: 'Integrated food processing company with snacks, beverages, and ready-to-eat products. Strong rural and urban distribution network.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Karvy Computershare Pvt Ltd',
    leadManagers: ['Anand Rathi', 'Equirus Capital'],
    rating: 4,
    ratingRationale: 'Growing FMCG sector, brand recognition, backward integration. Commodity price volatility is risk.',
  },

  // ===== SME IPOs (5 companies) =====
  {
    companyName: 'NanoTech Electronics Ltd',
    slug: 'nanotech-electronics-sme-ipo',
    category: 'SME',
    sector: 'Electronics',
    issueSize: '28.50',
    priceRangeMin: 45,
    priceRangeMax: 48,
    lotSize: 3000,
    status: 'LISTED',
    openDate: getRelativeDate(-25),
    closeDate: getRelativeDate(-23),
    allotmentDate: getRelativeDate(-18),
    listingDate: getRelativeDate(-15),
    companyDescription: 'SME manufacturing printed circuit boards and electronic assemblies for consumer electronics and industrial applications. ISO certified facility.',
    faceValue: 10,
    listingExchanges: ['NSE'],
    registrar: 'Bigshare Services Pvt Ltd',
    leadManagers: ['Hem Securities'],
    rating: 3,
    ratingRationale: 'Niche player in growing segment. Limited scale and working capital constraints are concerns.',
  },
  {
    companyName: 'EduTech Learning Solutions Ltd',
    slug: 'edutech-learning-sme-ipo',
    category: 'SME',
    sector: 'Education Technology',
    issueSize: '18.75',
    priceRangeMin: 32,
    priceRangeMax: 35,
    lotSize: 4000,
    status: 'CLOSED',
    openDate: getRelativeDate(-2),
    closeDate: getRelativeDate(0),
    allotmentDate: getRelativeDate(5),
    listingDate: getRelativeDate(8),
    companyDescription: 'EdTech platform offering K-12 online learning, test prep, and skill development courses. Growing subscriber base of 50,000+ students.',
    faceValue: 10,
    listingExchanges: ['BSE'],
    registrar: 'Cameo Corporate Services Ltd',
    leadManagers: ['Vivro Financial Services'],
    rating: 3,
    ratingRationale: 'High-growth EdTech space, scalable model. Profitability and customer retention need improvement.',
  },
  {
    companyName: 'BioHerbal Products Ltd',
    slug: 'bioherbal-products-sme-ipo',
    category: 'SME',
    sector: 'Herbal Products',
    issueSize: '22.00',
    priceRangeMin: 38,
    priceRangeMax: 42,
    lotSize: 3500,
    status: 'OPEN',
    openDate: getRelativeDate(0),
    closeDate: getRelativeDate(2),
    allotmentDate: getRelativeDate(7),
    listingDate: getRelativeDate(10),
    companyDescription: 'Manufacturer of ayurvedic and herbal personal care products. FSSAI and GMP certified manufacturing unit with 150+ SKUs.',
    faceValue: 10,
    listingExchanges: ['BSE'],
    registrar: 'Bigshare Services Pvt Ltd',
    leadManagers: ['Spread X Securities'],
    rating: 3,
    ratingRationale: 'Riding wellness trend, certified manufacturing. Small scale and brand visibility are limitations.',
  },
  {
    companyName: 'MicroFinance India Ltd',
    slug: 'microfinance-india-sme-ipo',
    category: 'SME',
    sector: 'Microfinance',
    issueSize: '35.00',
    priceRangeMin: 52,
    priceRangeMax: 55,
    lotSize: 2500,
    status: 'UPCOMING',
    openDate: getRelativeDate(8),
    closeDate: getRelativeDate(10),
    allotmentDate: getRelativeDate(15),
    listingDate: getRelativeDate(18),
    companyDescription: 'NBFC-MFI serving rural and semi-urban areas with microloans to women entrepreneurs. Active in 8 states with 125 branches.',
    faceValue: 10,
    listingExchanges: ['NSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Beeline Broking'],
    rating: 3,
    ratingRationale: 'Social impact, RBI regulated. Asset quality risks and competition from larger MFIs.',
  },
  {
    companyName: 'Smart Packaging Solutions Ltd',
    slug: 'smart-packaging-sme-ipo',
    category: 'SME',
    sector: 'Packaging',
    issueSize: '26.50',
    priceRangeMin: 44,
    priceRangeMax: 47,
    lotSize: 3000,
    status: 'UPCOMING',
    openDate: getRelativeDate(12),
    closeDate: getRelativeDate(14),
    allotmentDate: getRelativeDate(19),
    listingDate: getRelativeDate(22),
    companyDescription: 'Flexible packaging manufacturer for FMCG, pharma, and food sectors. Modern printing and lamination capabilities.',
    faceValue: 10,
    listingExchanges: ['BSE'],
    registrar: 'Cameo Corporate Services Ltd',
    leadManagers: ['Gretex Corporate Services'],
    rating: 3,
    ratingRationale: 'Essential industry, repeat customer orders. Raw material price fluctuations are concern.',
  },

  // ===== RIGHTS Issues (3 companies) =====
  {
    companyName: 'Legacy Steel Industries Ltd - Rights',
    slug: 'legacy-steel-rights-issue',
    category: 'RIGHTS',
    sector: 'Steel',
    issueSize: '380.00',
    priceRangeMin: 95,
    priceRangeMax: 95,
    lotSize: 100,
    status: 'LISTED',
    openDate: getRelativeDate(-40),
    closeDate: getRelativeDate(-25),
    allotmentDate: getRelativeDate(-20),
    listingDate: getRelativeDate(-17),
    companyDescription: 'Rights issue by established steel manufacturer for capacity expansion and debt reduction. Existing shareholders offered 1:3 rights entitlement.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['ICICI Securities'],
    rating: 4,
    ratingRationale: 'Existing profitable company, rights for growth capex. Dilution acceptable given expansion benefits.',
  },
  {
    companyName: 'Urban Properties REIT - Rights',
    slug: 'urban-properties-rights-issue',
    category: 'RIGHTS',
    sector: 'Real Estate',
    issueSize: '225.00',
    priceRangeMin: 72,
    priceRangeMax: 72,
    lotSize: 150,
    status: 'CLOSED',
    openDate: getRelativeDate(-4),
    closeDate: getRelativeDate(11),
    allotmentDate: getRelativeDate(16),
    listingDate: getRelativeDate(19),
    companyDescription: 'Rights issue by commercial REIT for acquiring Grade A office properties in Bangalore and Pune. 1:5 rights to existing unitholders.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['Axis Capital'],
    rating: 4,
    ratingRationale: 'Quality asset acquisition, stable rental yields. Market timing during rising interest rates noted.',
  },
  {
    companyName: 'Regional Power Grid Ltd - Rights',
    slug: 'regional-power-rights-issue',
    category: 'RIGHTS',
    sector: 'Power',
    issueSize: '465.00',
    priceRangeMin: 118,
    priceRangeMax: 118,
    lotSize: 80,
    status: 'UPCOMING',
    openDate: getRelativeDate(5),
    closeDate: getRelativeDate(20),
    allotmentDate: getRelativeDate(25),
    listingDate: getRelativeDate(28),
    companyDescription: 'Rights issue by state power transmission utility for grid modernization and smart metering project. 1:4 rights entitlement.',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Karvy Computershare Pvt Ltd',
    leadManagers: ['SBI Capital Markets'],
    rating: 4,
    ratingRationale: 'Government-backed utility, regulated returns. Long gestation for projects is consideration.',
  },

  // ===== NCD Issues (2 companies) =====
  {
    companyName: 'Infrafinance Corporation Ltd - NCD',
    slug: 'infrafinance-ncd-issue',
    category: 'NCD',
    sector: 'Infrastructure Finance',
    issueSize: '750.00',
    priceRangeMin: 1000,
    priceRangeMax: 1000,
    lotSize: 10,
    status: 'LISTED',
    openDate: getRelativeDate(-35),
    closeDate: getRelativeDate(-30),
    allotmentDate: getRelativeDate(-25),
    listingDate: getRelativeDate(-22),
    companyDescription: 'Secured NCDs offering 9.25% p.a. for 36-month tenure. AAA rated NBFC specializing in infrastructure project financing.',
    faceValue: 1000,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies Ltd',
    leadManagers: ['HDFC Bank', 'Axis Bank'],
    rating: 5,
    ratingRationale: 'AAA credit rating, secured NCDs, attractive yield. Safe debt investment for conservative investors.',
  },
  {
    companyName: 'Housing Finance Ltd - NCD',
    slug: 'housing-finance-ncd-issue',
    category: 'NCD',
    sector: 'Housing Finance',
    issueSize: '500.00',
    priceRangeMin: 1000,
    priceRangeMax: 1000,
    lotSize: 10,
    status: 'OPEN',
    openDate: getRelativeDate(-1),
    closeDate: getRelativeDate(14),
    allotmentDate: getRelativeDate(19),
    listingDate: getRelativeDate(22),
    companyDescription: 'Secured and unsecured NCDs with varying tenures (24/36/60 months) offering 8.75%-9.50% p.a. AA+ rated housing finance company.',
    faceValue: 1000,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime India Pvt Ltd',
    leadManagers: ['ICICI Bank', 'Kotak Mahindra Bank'],
    rating: 4,
    ratingRationale: 'AA+ rating, established HFC, competitive yields. Slightly higher risk than AAA bonds.',
  },
];

const SAMPLE_REGISTRARS = [
  {
    name: 'KFin Technologies Ltd',
    website: 'https://www.kfintech.com',
    email: 'einward.ris@kfintech.com',
    phone: '+91-40-6716-2222',
    address: 'Selenium Tower B, Plot 31-32, Financial District, Hyderabad - 500032',
  },
  {
    name: 'Link Intime India Pvt Ltd',
    website: 'https://www.linkintime.co.in',
    email: 'mumbai@linkintime.co.in',
    phone: '+91-22-4918-6000',
    address: 'C-101, 247 Park, L.B.S. Marg, Vikhroli West, Mumbai - 400083',
  },
  {
    name: 'Karvy Computershare Pvt Ltd',
    website: 'https://www.karvycomputershare.com',
    email: 'einward.ris@karvy.com',
    phone: '+91-40-6716-1500',
    address: 'Karvy Selenium Tower B, Plot 31-32, Gachibowli, Hyderabad - 500032',
  },
  {
    name: 'Bigshare Services Pvt Ltd',
    website: 'https://www.bigshareonline.com',
    email: 'ipo@bigshareonline.com',
    phone: '+91-22-6263-8200',
    address: 'E-2/3, Ansa Industrial Estate, Sakivihar Road, Saki Naka, Mumbai - 400072',
  },
  {
    name: 'Cameo Corporate Services Ltd',
    website: 'https://www.cameoindia.com',
    email: 'investor@cameoindia.com',
    phone: '+91-44-2846-0390',
    address: 'Subramanian Building, No.1, Club House Road, Chennai - 600002',
  },
  {
    name: 'Alankit Assignments Ltd',
    website: 'https://www.alankit.com',
    email: 'rta@alankit.com',
    phone: '+91-11-4254-1234',
    address: 'Alankit House, 2E/21, Jhandewalan Extension, New Delhi - 110055',
  },
  {
    name: 'Skyline Financial Services Pvt Ltd',
    website: 'https://www.skylinerta.com',
    email: 'admin@skylinerta.com',
    phone: '+91-22-2261-5606',
    address: 'D-153A, 1st Floor, Okhla Industrial Area, Phase-I, New Delhi - 110020',
  },
  {
    name: 'MAS Services Ltd',
    website: 'https://www.masserv.com',
    email: 'info@masserv.com',
    phone: '+91-11-2638-7281',
    address: 'AB-4, Safdarjung Enclave, New Delhi - 110029',
  },
  {
    name: 'Sharepro Services India Pvt Ltd',
    website: 'https://www.shareproservices.com',
    email: 'sharepro@shareproservices.com',
    phone: '+91-22-6772-0300',
    address: '13AB, Samhita Warehousing Complex, Sakinaka, Mumbai - 400072',
  },
  {
    name: 'Beetal Financial & Computer Services Pvt Ltd',
    website: 'https://www.beetalfinancial.com',
    email: 'beetalrta@gmail.com',
    phone: '+91-11-2920-5945',
    address: 'Beetal House, 3rd Floor, 99 Madangir, New Delhi - 110062',
  },
];

const MARKET_HOLIDAYS_2025 = [
  { date: '2025-01-26', description: 'Republic Day', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-03-14', description: 'Holi', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-03-31', description: 'Id-Ul-Fitr (Ramadan Eid)', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-04-10', description: 'Mahavir Jayanti', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-04-14', description: 'Dr. Baba Saheb Ambedkar Jayanti', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-04-18', description: 'Good Friday', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-05-01', description: 'Maharashtra Day', type: 'TRADING', exchange: 'BSE', year: 2025 },
  { date: '2025-06-07', description: 'Bakri Id', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-07-06', description: 'Moharram', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-08-15', description: 'Independence Day', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-08-27', description: 'Ganesh Chaturthi', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-10-02', description: 'Mahatma Gandhi Jayanti', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-10-20', description: 'Diwali-Laxmi Pujan', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-11-05', description: 'Gurunanak Jayanti', type: 'TRADING', exchange: 'BOTH', year: 2025 },
  { date: '2025-12-25', description: 'Christmas', type: 'TRADING', exchange: 'BOTH', year: 2025 },
];

const BROKER_AFFILIATES = [
  {
    brokerName: 'Zerodha',
    affiliateUrl: 'https://zerodha.com/open-account?c=IPODHAN',
    logoUrl: 'https://zerodha.com/static/images/logo.svg',
    isActive: true,
  },
  {
    brokerName: 'Upstox',
    affiliateUrl: 'https://upstox.com/open-demat-account/?f=IPODHAN',
    logoUrl: 'https://upstox.com/app/themes/upstox/dist/img/logo/logo.png',
    isActive: true,
  },
  {
    brokerName: 'Angel One',
    affiliateUrl: 'https://www.angelone.in/open-demat-account?utm_source=IPODHAN',
    logoUrl: 'https://www.angelone.in/images/logo.png',
    isActive: true,
  },
];

// ==================== MAIN SEED FUNCTION ====================

async function seedDatabase() {
  const startTime = Date.now();
  console.log('\n='.repeat(60));
  console.log('IPODhan Database Seeding Started');
  console.log('='.repeat(60));

  try {
    // Try to get Redis client, but don't fail if Redis is unavailable
    let redis;
    try {
      redis = getRedisClient();
    } catch {
      console.log('⚠️  Redis unavailable - continuing without cache');
      // Create a mock Redis client for repositories
      redis = {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
        flushdb: async () => 'OK',
      } as unknown as Redis;
    }

    // Check if data already exists (idempotency)
    console.log('\n[1/7] Checking existing data...');
    const existingIPOCount = await db.select({ count: count() }).from(ipos);
    const ipoCount = Number(existingIPOCount[0]?.count || 0);

    if (ipoCount > 0) {
      console.log(`⚠️  Database already contains ${ipoCount} IPOs`);
      console.log('Seed script is idempotent - skipping to avoid duplicates');
      console.log('To re-seed, please truncate tables manually first');
      return;
    }

    // Initialize repositories
    console.log('\n[2/7] Initializing repositories...');
    const ipoRepo = new IPORepository(db, redis);
    const subRepo = new SubscriptionRepository(db, redis);
    const gmpRepo = new GMPRepository(db, redis);
    const finRepo = new FinancialDataRepository(db, redis);
    const docRepo = new DocumentRepository(db, redis);
    const listRepo = new ListingPerformanceRepository(db, redis);
    console.log('✓ All repositories initialized');

    // Seed registrars
    console.log('\n[3/7] Seeding registrars...');
    for (const registrar of SAMPLE_REGISTRARS) {
      await db.insert(registrars).values(registrar);
    }
    console.log(`✓ Seeded ${SAMPLE_REGISTRARS.length} registrars`);

    // Seed market holidays
    console.log('\n[4/7] Seeding market holidays...');
    for (const holiday of MARKET_HOLIDAYS_2025) {
      await db.insert(marketHolidays).values({
        date: holiday.date,
        description: holiday.description,
        type: holiday.type as 'TRADING' | 'SETTLEMENT' | 'BOTH',
        exchange: holiday.exchange as 'NSE' | 'BSE' | 'BOTH',
        year: holiday.year,
      });
    }
    console.log(`✓ Seeded ${MARKET_HOLIDAYS_2025.length} market holidays for 2025`);

    // Seed broker affiliates
    console.log('\n[5/7] Seeding broker affiliates...');
    for (const broker of BROKER_AFFILIATES) {
      await db.insert(brokerAffiliates).values(broker);
    }
    console.log(`✓ Seeded ${BROKER_AFFILIATES.length} broker affiliates`);

    // Seed IPOs and relationships
    console.log('\n[6/7] Seeding IPOs and relationships...');
    console.log(`Creating ${SAMPLE_IPOS.length} IPOs with full data...`);

    for (let i = 0; i < SAMPLE_IPOS.length; i++) {
      const ipoData = SAMPLE_IPOS[i];
      const progress = `[${i + 1}/${SAMPLE_IPOS.length}]`;

      console.log(`\n${progress} ${ipoData.companyName} (${ipoData.category}, ${ipoData.status})`);

      // Create IPO
      const ipo = await ipoRepo.create({
        companyName: ipoData.companyName,
        slug: ipoData.slug,
        category: ipoData.category,
        sector: ipoData.sector,
        issueSize: ipoData.issueSize,
        priceRangeMin: ipoData.priceRangeMin,
        priceRangeMax: ipoData.priceRangeMax,
        lotSize: ipoData.lotSize,
        status: ipoData.status,
        openDate: ipoData.openDate.toISOString().split('T')[0],
        closeDate: ipoData.closeDate.toISOString().split('T')[0],
        allotmentDate: ipoData.allotmentDate ? ipoData.allotmentDate.toISOString().split('T')[0] : null,
        listingDate: ipoData.listingDate ? ipoData.listingDate.toISOString().split('T')[0] : null,
        companyDescription: ipoData.companyDescription,
        faceValue: ipoData.faceValue,
        listingExchanges: ipoData.listingExchanges,
        registrar: ipoData.registrar,
        leadManagers: ipoData.leadManagers,
        rating: ipoData.rating,
        ratingRationale: ipoData.ratingRationale,
      });
      console.log(`  ✓ Created IPO: ${ipo.id}`);

      // Create financial data
      const financialData = {
        ipoId: ipo.id,
        eps: randomDecimal(5, 50),
        peRatio: randomDecimal(10, 40),
        netWorth: randomDecimal(300, 5000),
        totalAssets: randomDecimal(500, 10000),
      };
      await finRepo.upsert(financialData);
      console.log(`  ✓ Created financial data`);

      // Create documents (2-3 per IPO)
      const docTypes: Array<'DRHP' | 'RHP' | 'PROSPECTUS' | 'ADDENDUM'> = ['DRHP', 'RHP', 'PROSPECTUS'];
      const docCount = randomInRange(2, 3);
      for (let d = 0; d < docCount; d++) {
        await docRepo.create({
          ipoId: ipo.id,
          type: docTypes[d % docTypes.length],
          title: `${docTypes[d % docTypes.length]} - ${ipoData.companyName}`,
          url: `https://storage.ipodhan.com/documents/${ipoData.slug}-${docTypes[d % docTypes.length].toLowerCase()}.pdf`,
        });
      }
      console.log(`  ✓ Created ${docCount} documents`);

      // Create subscription data for OPEN/CLOSED/LISTED IPOs
      if (['OPEN', 'CLOSED', 'LISTED'].includes(ipoData.status)) {
        const subCount = randomInRange(3, 5);
        for (let s = 0; s < subCount; s++) {
          const dayOffset = s;
          const timestamp = new Date(ipoData.openDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);

          await subRepo.createSnapshot({
            ipoId: ipo.id,
            timestamp,
            qibSubscription: randomDecimal(0.5, 15, 2),
            niiSubscription: randomDecimal(1, 25, 2),
            retailSubscription: randomDecimal(0.8, 10, 2),
            totalSubscription: randomDecimal(1, 15, 2),
            totalApplications: randomInRange(50000, 500000),
            totalSharesBid: randomInRange(10000000, 100000000),
            sharesOffered: randomInRange(5000000, 50000000),
          });
        }
        console.log(`  ✓ Created ${subCount} subscription snapshots`);
      }

      // Create GMP data for OPEN/CLOSED/LISTED IPOs
      if (['OPEN', 'CLOSED', 'LISTED'].includes(ipoData.status)) {
        const gmpCount = randomInRange(5, 7);
        for (let g = 0; g < gmpCount; g++) {
          const dayOffset = -5 + g;
          const timestamp = new Date(ipoData.openDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
          const gmpValue = randomInRange(10, 150);

          await gmpRepo.create({
            ipoId: ipo.id,
            timestamp,
            gmp: gmpValue,
            expectedListingPrice: ipoData.priceRangeMax + gmpValue,
            source: 'IPO Central',
          });
        }
        console.log(`  ✓ Created ${gmpCount} GMP records`);
      }

      // Create listing performance for LISTED IPOs
      if (ipoData.status === 'LISTED') {
        const listingPrice = ipoData.priceRangeMax + randomInRange(-10, 80);
        const listingGain = ((listingPrice - ipoData.priceRangeMax) / ipoData.priceRangeMax) * 100;
        const currentPrice = listingPrice + randomInRange(-20, 50);
        const currentGain = ((currentPrice - ipoData.priceRangeMax) / ipoData.priceRangeMax) * 100;

        await listRepo.upsert({
          ipoId: ipo.id,
          listingPrice: listingPrice,
          issuePrice: ipoData.priceRangeMax,
          listingGainPercent: listingGain.toFixed(2),
          currentPrice: currentPrice,
          currentGainPercent: currentGain.toFixed(2),
        });
        console.log(`  ✓ Created listing performance (Listing: ${listingGain.toFixed(2)}%, Current: ${currentGain.toFixed(2)}%)`);
      }

      // Add peer companies for some mainboard IPOs
      if (ipoData.category === 'MAINBOARD' && i % 3 === 0) {
        const peerCount = randomInRange(2, 4);
        for (let p = 0; p < peerCount; p++) {
          await db.insert(peerCompanies).values({
            ipoId: ipo.id,
            companyName: `${ipoData.sector} Peer ${p + 1} Ltd`,
            isListed: true,
            peRatio: randomDecimal(10, 40),
            eps: randomDecimal(5, 50),
            dilutedEps: randomDecimal(5, 48),
            ronw: randomDecimal(10, 30),
            nav: randomDecimal(50, 300),
            pbvRatio: randomDecimal(1, 5),
          });
        }
        console.log(`  ✓ Created ${peerCount} peer comparisons`);
      }
    }

    console.log('\n[7/7] Seed data summary:');
    console.log(`  • ${SAMPLE_IPOS.length} IPOs created`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.category === 'MAINBOARD').length} MAINBOARD`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.category === 'SME').length} SME`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.category === 'RIGHTS').length} RIGHTS`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.category === 'NCD').length} NCD`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.status === 'UPCOMING').length} UPCOMING`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.status === 'OPEN').length} OPEN`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.status === 'CLOSED').length} CLOSED`);
    console.log(`  • ${SAMPLE_IPOS.filter(i => i.status === 'LISTED').length} LISTED`);
    console.log(`  • ${SAMPLE_REGISTRARS.length} registrars`);
    console.log(`  • ${MARKET_HOLIDAYS_2025.length} market holidays`);
    console.log(`  • ${BROKER_AFFILIATES.length} broker affiliates`);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n='.repeat(60));
    console.log(`✓ Seed completed successfully in ${elapsedTime}s`);
    console.log('='.repeat(60));
    console.log('\nYou can now:');
    console.log('  • Start the dev server: npm run dev');
    console.log('  • Open Drizzle Studio: npm run db:studio');
    console.log('  • Run the app and explore sample IPO data');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Seed failed with error:');
    console.error(error);
    process.exit(1);
  } finally {
    // Close database connection
    process.exit(0);
  }
}

// ==================== EXECUTION ====================

// Run seed function
seedDatabase();
