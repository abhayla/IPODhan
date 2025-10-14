# Screen-Table-Database Field Mapping

This document maps UI screens, tables, and columns to database tables, fields, and their scrape sources.

**Legend:**
- **Scrape Source Priority**: NSE(1) > BSE(2) > Moneycontrol(3) > Chittorgarh(4) > API_Fallback(5)
- **Table Columns**: Visible in data tables/grids
- **Detail View Fields**: Visible in detail/card views but not in tables

---

**Database Schema Source**: `web/drizzle/migrations/schema.ts` (actual migration schema - latest)

---

## Homepage (/)

### IPO 2025 List (Mainboard)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |
| Open | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |
| Close | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, IPO List Pages, Dashboard |

### SME IPO 2025 List
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |
| Open | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |
| Close | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages, Dashboard |

### Upcoming Mainboard IPOs (Filed with SEBI)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, Mainboard IPO Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Homepage, All IPO Pages |
| Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, All IPO Pages |

### Upcoming SME IPOs (Filed with BSE/NSE)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, SME IPO Pages |
| Status | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Homepage, All IPO Pages |
| Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Homepage, All IPO Pages |

---

## IPO Detail Page (/ipos/[slug])

### IPO Header (Hero Section)
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Company Logo | ipos | - | - | Manual Upload | IPO Detail Page |
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, All Lists |
| Status Badge | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, All Lists |
| Category Badge | ipos | category | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, All Lists |
| Sector | ipos | sector | VARCHAR(100) | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| IPODhan Rating | ipos | rating | INTEGER | Internal Rating Algorithm | IPO Detail Page |
| Rating Rationale | ipos | rating_rationale | TEXT | Internal Rating Algorithm | IPO Detail Page |

### Key Metrics Cards
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Issue Size | ipos | issue_size | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, Lists |
| Subscription (Times) | subscriptions | total_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | IPO Detail Page |
| Grey Market Premium | ipos | gmp | NUMERIC(10,2) | Chittorgarh(4) | IPO Detail Page |
| GMP Percentage | ipos | gmp_percentage | NUMERIC(5,2) | Chittorgarh(4) | IPO Detail Page |

### IPO Details Section
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Open Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, Lists |
| Close Date | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | IPO Detail Page, Lists |
| Allotment Date | ipos | allotment_date | DATE | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Listing Date | ipos | listing_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4) | IPO Detail Page, Lists |
| Price Range | ipos | price_band_low, price_band_high | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page |
| Face Value | ipos | face_value | INTEGER | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Lot Size | ipos | lot_size | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | IPO Detail Page, Calculators |
| Listing Exchanges | ipos | listing_exchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | IPO Detail Page |
| Registrar | registrars | name | VARCHAR(255) | NSE(1), BSE(2) + Registrars Scraper | IPO Detail Page, Registrar Pages |
| Lead Managers | ipos | lead_managers | JSONB | NSE(1), BSE(2) | IPO Detail Page |

### Listing Performance Section
*Table Rows (Metrics)*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issue Price | listing_performance | issue_price | INTEGER | NSE(1), BSE(2) | IPO Detail Page |
| Listing Price | listing_performance | listing_price | INTEGER | NSE(1), BSE(2), Historical Scraper | IPO Detail Page, Performance Trackers |
| Listing Day Return | listing_performance | listing_gain_percent | NUMERIC(5,2) | Calculated | IPO Detail Page, Performance Trackers |
| Current Price | listing_performance | current_price_nse, current_price_bse | INTEGER | Historical Scraper | IPO Detail Page, Performance Trackers |
| Overall Return | listing_performance | current_gain_percent | NUMERIC(5,2) | Calculated | IPO Detail Page, Performance Trackers |

### Financials Tab
*Table Columns & Rows*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Revenue FY 2022 | financial_data | revenue_fy2022 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Revenue FY 2023 | financial_data | revenue_fy2023 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Revenue FY 2024 | financial_data | revenue_fy2024 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Net Profit FY 2022 | financial_data | profit_fy2022 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Net Profit FY 2023 | financial_data | profit_fy2023 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Net Profit FY 2024 | financial_data | profit_fy2024 | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| EPS (₹) | financial_data | eps | NUMERIC(10,2) | Prospectus Documents | IPO Detail Page |
| P/E Ratio | financial_data | pe_ratio | NUMERIC(10,2) | Prospectus Documents | IPO Detail Page |
| ROE (%) | financial_data | roe | NUMERIC(5,2) | Prospectus Documents | IPO Detail Page |
| Debt to Equity | financial_data | debt_to_equity | NUMERIC(10,2) | Prospectus Documents | IPO Detail Page |
| Total Assets | financial_data | total_assets | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |
| Total Borrowing | financial_data | total_borrowing | NUMERIC(12,2) | Prospectus Documents | IPO Detail Page |

### Subscription Tab
*Detail View Fields with Progress Bars*

| UI Category | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-------------|----------|-----------|------|----------------|-----------------|
| Total Subscription | subscriptions | total_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | IPO Detail Page, Lists |
| QIB | subscriptions | qib_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | IPO Detail Page |
| NII | subscriptions | nii_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | IPO Detail Page |
| Retail | subscriptions | retail_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | IPO Detail Page |
| Total Applications | subscriptions | total_applications | INTEGER | NSE(1), BSE(2) | IPO Detail Page |
| Shares Bid | subscriptions | total_shares_bid | BIGINT | NSE(1), BSE(2) | IPO Detail Page |

### GMP Tab
*Chart Data & Fields*

| UI Field/Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------------|----------|-----------|------|----------------|-----------------|
| Latest GMP | ipos | gmp | NUMERIC(10,2) | Chittorgarh(4) | IPO Detail Page, Lists |
| Expected Listing Price | gmp_records | expected_listing_price | INTEGER | Chittorgarh(4) | IPO Detail Page |
| GMP History (7-day) | gmp_records | gmp, timestamp | INTEGER, TIMESTAMP | Chittorgarh(4) | IPO Detail Page |
| GMP Updated At | ipos | gmp_updated_at | TIMESTAMP | Chittorgarh(4) | IPO Detail Page |

### Documents Tab
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Document Title | documents | title | VARCHAR(255) | Prospectus Scraper (NSE/BSE) | IPO Detail Page, Prospectus Pages |
| Document Type | documents | type | ENUM | Prospectus Scraper (NSE/BSE) | IPO Detail Page, Prospectus Pages |
| File Size | documents | file_size | BIGINT | Prospectus Scraper (NSE/BSE) | IPO Detail Page |
| Upload Date | documents | uploaded_at | TIMESTAMP | Prospectus Scraper (NSE/BSE) | IPO Detail Page |
| Download URL | documents | url | TEXT | Prospectus Scraper (NSE/BSE) | IPO Detail Page |

### Company Overview Tab
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Business Model | ipos | company_description | TEXT | NSE(1), BSE(2), Prospectus Documents | IPO Detail Page |

---

## Mainboard IPO Performance Tracker (/mainboard-ipo-performance-tracker)

### Performance Tracker Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Performance Tracker, All Pages |
| Listed On | ipos | listing_date | DATE | NSE(1), BSE(2), Historical Scraper | Performance Tracker |
| Issue Price | listing_performance | issue_price | INTEGER | NSE(1), BSE(2) | Performance Tracker, IPO Detail |
| Listing Day Close | listing_performance | listing_price | INTEGER | NSE(1), BSE(2), Historical Scraper | Performance Tracker, IPO Detail |
| Listing Day Gain | listing_performance | listing_gain_percent | NUMERIC(5,2) | Calculated | Performance Tracker, IPO Detail |
| Current Price | listing_performance | current_price_nse, current_price_bse | INTEGER | Historical Scraper | Performance Tracker, IPO Detail |
| Profit/Loss | listing_performance | current_gain_percent | NUMERIC(5,2) | Calculated | Performance Tracker, IPO Detail |

---

## SME IPO Performance Tracker (/sme-ipo-performance-tracker)

### Performance Tracker Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Performance Tracker, All Pages |
| Listed On | ipos | listing_date | DATE | NSE(1), BSE(2), Historical Scraper | Performance Tracker |
| Issue Price | listing_performance | issue_price | INTEGER | NSE(1), BSE(2) | Performance Tracker, IPO Detail |
| Listing Day Close | listing_performance | listing_price | INTEGER | NSE(1), BSE(2), Historical Scraper | Performance Tracker, IPO Detail |
| Listing Day Gain | listing_performance | listing_gain_percent | NUMERIC(5,2) | Calculated | Performance Tracker, IPO Detail |
| Current Price | listing_performance | current_price_nse, current_price_bse | INTEGER | Historical Scraper | Performance Tracker, IPO Detail |
| Profit/Loss | listing_performance | current_gain_percent | NUMERIC(5,2) | Calculated | Performance Tracker, IPO Detail |

---

## Mainboard IPO Calendar (/mainboard-ipo-calendar)

### Calendar Events Display
*Detail View Fields (Calendar Cells)*

| UI Field/Event | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Calendar, All Pages |
| Open Date Event | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Calendar |
| Close Date Event | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Calendar |
| Allotment Date Event | ipos | allotment_date | DATE | NSE(1), BSE(2), Moneycontrol(3) | Calendar |
| Listing Date Event | ipos | listing_date | DATE | NSE(1), BSE(2), Moneycontrol(3) | Calendar |
| Holiday Events | market_holidays | date, description | DATE, VARCHAR(255) | Market Holidays Scraper | Calendar |
| Holiday Exchange | market_holidays | exchange | ENUM | Market Holidays Scraper | Calendar |

---

## SME IPO Calendar (/sme-ipo-calendar)

### Calendar Events Display
*Detail View Fields (Calendar Cells)*

| UI Field/Event | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Calendar, All Pages |
| Open Date Event | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Calendar |
| Close Date Event | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Calendar |
| Allotment Date Event | ipos | allotment_date | DATE | NSE(1), BSE(2), Moneycontrol(3) | Calendar |
| Listing Date Event | ipos | listing_date | DATE | NSE(1), BSE(2), Moneycontrol(3) | Calendar |
| Holiday Events | market_holidays | date, description | DATE, VARCHAR(255) | Market Holidays Scraper | Calendar |

---

## Market Holidays (/market-holidays)

### Market Holidays Cards
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Date | market_holidays | date | DATE | Market Holidays Scraper (NSE/BSE) | Market Holidays Page |
| Holiday Description | market_holidays | description | VARCHAR(255) | Market Holidays Scraper (NSE/BSE) | Market Holidays Page, Calendars |
| Holiday Type | market_holidays | type | ENUM | Market Holidays Scraper (NSE/BSE) | Market Holidays Page |
| Exchange | market_holidays | exchange | ENUM | Market Holidays Scraper (NSE/BSE) | Market Holidays Page, Calendars |
| Year | market_holidays | year | INTEGER | Market Holidays Scraper (NSE/BSE) | Market Holidays Page |

---

## Registrars Directory (/registrars)

### Registrars Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Name (Short Name/Full Name) | registrars | short_name, name | VARCHAR(100), VARCHAR(255) | Registrars Scraper, Manual Entry | Registrars Page, IPO Detail |
| Email | registrars | email | VARCHAR(255) | Registrars Scraper, Manual Entry | Registrars Page |
| Phone | registrars | phone | VARCHAR(20) | Registrars Scraper, Manual Entry | Registrars Page |
| Website | registrars | website | TEXT | Registrars Scraper, Manual Entry | Registrars Page |
| Allotment Check URL | registrars | allotment_check_url | TEXT | Registrars Scraper, Manual Entry | Registrars Page, IPO Detail |
| Address | registrars | address | TEXT | Registrars Scraper, Manual Entry | Registrars Page |

---

## Mainboard IPO Prospectus (/mainboard-ipo-prospectus)

### Prospectus Documents Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Prospectus Pages, All Pages |
| Exchange | ipos | listing_exchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | Prospectus Pages, IPO Detail |
| DRHP PDF | documents | url (where type='DRHP') | TEXT | Prospectus Scraper (NSE/BSE) | Prospectus Pages, IPO Detail |
| RHP PDF | documents | url (where type='RHP') | TEXT | Prospectus Scraper (NSE/BSE) | Prospectus Pages, IPO Detail |

---

## SME IPO Prospectus (/sme-ipo-prospectus)

### Prospectus Documents Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Prospectus Pages, All Pages |
| Exchange | ipos | listing_exchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | Prospectus Pages, IPO Detail |
| DRHP PDF | documents | url (where type='DRHP') | TEXT | Prospectus Scraper (NSE/BSE) | Prospectus Pages, IPO Detail |
| RHP PDF | documents | url (where type='RHP') | TEXT | Prospectus Scraper (NSE/BSE) | Prospectus Pages, IPO Detail |

---

## Mainboard IPO Reviews (/mainboard-ipo-reviews)

### IPO Reviews Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| # (Row Number) | - | - | - | Calculated | Reviews Pages |
| Review Title | ipo_reviews | review_title | VARCHAR(500) | Manual Entry, Content Scraper | Reviews Pages |
| Author | ipo_reviews | author | VARCHAR(255) | Manual Entry, Content Scraper | Reviews Pages |
| Recommendation | ipo_reviews | recommendation | ENUM | Manual Entry, Content Scraper | Reviews Pages |
| IPO (Company Name) | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Reviews Pages |

*Additional Fields (not in table)*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Published Date | ipo_reviews | published_date | TIMESTAMP | Manual Entry, Content Scraper | Reviews Pages |
| Review URL | ipo_reviews | review_url | TEXT | Manual Entry, Content Scraper | Reviews Pages |
| Review Content | ipo_reviews | review_content | TEXT | Manual Entry, Content Scraper | Review Detail Page |
| Year | ipo_reviews | year | INTEGER | Manual Entry, Content Scraper | Reviews Pages (filter) |

---

## SME IPO Reviews (/sme-ipo-reviews)

### IPO Reviews Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| # (Row Number) | - | - | - | Calculated | Reviews Pages |
| Review Title | ipo_reviews | review_title | VARCHAR(500) | Manual Entry, Content Scraper | Reviews Pages |
| Author | ipo_reviews | author | VARCHAR(255) | Manual Entry, Content Scraper | Reviews Pages |
| Recommendation | ipo_reviews | recommendation | ENUM | Manual Entry, Content Scraper | Reviews Pages |
| IPO (Company Name) | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Reviews Pages |

*Additional Fields (not in table)*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Published Date | ipo_reviews | published_date | TIMESTAMP | Manual Entry, Content Scraper | Reviews Pages |
| Review URL | ipo_reviews | review_url | TEXT | Manual Entry, Content Scraper | Reviews Pages |
| Review Content | ipo_reviews | review_content | TEXT | Manual Entry, Content Scraper | Review Detail Page |
| Year | ipo_reviews | year | INTEGER | Manual Entry, Content Scraper | Reviews Pages (filter) |

---

## Dashboard Page (/dashboard)

### IPO Grid/List View
*Card View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Pages |
| Status Badge | ipos | status | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, All Pages |
| Category Badge | ipos | category | VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, All Pages |
| Sector | ipos | sector | VARCHAR(100) | NSE(1), BSE(2), Moneycontrol(3) | Dashboard, IPO Detail |
| Price Range Min | ipos | price_band_low | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, IPO Detail |
| Price Range Max | ipos | price_band_high | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, IPO Detail |
| Lot Size | ipos | lot_size | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Dashboard, IPO Detail, Calculators |
| Open Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Pages |
| Close Date | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Dashboard, All Pages |
| IPODhan Rating | ipos | rating | INTEGER | Internal Rating Algorithm | Dashboard, IPO Detail |
| Listing Performance % | listing_performance | current_gain_percent | NUMERIC(5,2) | Calculated | Dashboard, Performance Trackers |

---

## Mainboard IPOs Page (/mainboard-ipos)

### Summary Metrics Dashboard
*Card Metrics*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Total Mainboard IPOs | ipos | COUNT(*) WHERE category='MAINBOARD' | - | Calculated | Mainboard IPOs Page |
| Listed in Gain | listing_performance | COUNT(*) WHERE current_gain_percent > 0 | - | Calculated | Mainboard IPOs Page |
| Listed in Loss | listing_performance | COUNT(*) WHERE current_gain_percent < 0 | - | Calculated | Mainboard IPOs Page |
| Upcoming & OnGoing | ipos | COUNT(*) WHERE status IN ('UPCOMING','OPEN') | - | Calculated | Mainboard IPOs Page |
| Gain (All Over Time) | listing_performance | AVG(current_gain_percent) WHERE > 0 | - | Calculated | Mainboard IPOs Page |
| Loss (All Over Time) | listing_performance | AVG(current_gain_percent) WHERE < 0 | - | Calculated | Mainboard IPOs Page |

### Detailed Mainboard IPO Listings Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company | ipos | company_name, status | VARCHAR(255), VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard IPOs Page |
| Opening Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard IPOs Page |
| Closing Date | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Mainboard IPOs Page |
| Listing Date | ipos | listing_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4) | Mainboard IPOs Page |
| Issue Price | ipos | price_band_high | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Mainboard IPOs Page |
| Total Issue Amount | ipos | issue_size | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Mainboard IPOs Page |
| Listing At | ipos | listing_exchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | Mainboard IPOs Page |
| Lead Manager | ipos | lead_managers | JSONB | NSE(1), BSE(2) | Mainboard IPOs Page |

---

## SME IPOs Page (/sme-ipos)

### Summary Metrics Dashboard
*Card Metrics*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Total SME IPOs | ipos | COUNT(*) WHERE category='SME' | - | Calculated | SME IPOs Page |
| Listed in Gain | listing_performance | COUNT(*) WHERE current_gain_percent > 0 | - | Calculated | SME IPOs Page |
| Listed in Loss | listing_performance | COUNT(*) WHERE current_gain_percent < 0 | - | Calculated | SME IPOs Page |
| Upcoming & OnGoing | ipos | COUNT(*) WHERE status IN ('UPCOMING','OPEN') | - | Calculated | SME IPOs Page |
| Gain (All Over Time) | listing_performance | AVG(current_gain_percent) WHERE > 0 | - | Calculated | SME IPOs Page |
| Loss (All Over Time) | listing_performance | AVG(current_gain_percent) WHERE < 0 | - | Calculated | SME IPOs Page |

### Detailed SME IPO Listings Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company | ipos | company_name, status | VARCHAR(255), VARCHAR(20) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME IPOs Page |
| Opening Date | ipos | open_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME IPOs Page |
| Closing Date | ipos | close_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | SME IPOs Page |
| Listing Date | ipos | listing_date | DATE | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4) | SME IPOs Page |
| Issue Price | ipos | price_band_high | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | SME IPOs Page |
| Total Issue Amount | ipos | issue_size | NUMERIC(12,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | SME IPOs Page |
| Listing At | ipos | listing_exchanges | JSONB | NSE(1), BSE(2), Moneycontrol(3) | SME IPOs Page |
| Lead Manager | ipos | lead_managers | JSONB | NSE(1), BSE(2) | SME IPOs Page |

---

## Lot Calculator Tool (/tools/lot-calculator)

### Calculator Form & Results
*Form Input Fields*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| Select IPO (Dropdown) | ipos | company_name, category, status, price_band_high, lot_size | Multiple | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Lot Calculator |
| Investment Amount | - | - | User Input | User Input | Lot Calculator |

*Output/Calculated Fields*

| UI Field | Calculation Source | Type | Used In Screens |
|----------|-------------------|------|-----------------|
| Number of Lots | Calculated: investment_amount / (price * lot_size) | INTEGER | Lot Calculator, IPO Detail |
| Total Shares | Calculated: lots * lot_size | INTEGER | Lot Calculator, IPO Detail |
| Total Investment | Calculated: lots * lot_size * price | DECIMAL | Lot Calculator, IPO Detail |
| Calculation Formula | Display String | TEXT | Lot Calculator |

---

## Compare IPOs Tool (/tools/compare)

### IPO Selector & Comparison Table
*Selection Fields*

| UI Field | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------|----------|-----------|------|----------------|-----------------|
| IPO Multi-Select (max 3) | ipos | company_name, status, lot_size, price_band_low, price_band_high | Multiple | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |

*Comparison Metrics Table*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Price Range (Min/Max) | ipos | price_band_low, price_band_high | NUMERIC(10,2) | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |
| Lot Size | ipos | lot_size | INTEGER | NSE(1), BSE(2), Moneycontrol(3), API_Fallback(5) | Compare Tool |
| QIB Subscription | subscriptions | qib_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | Compare Tool |
| NII Subscription | subscriptions | nii_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | Compare Tool |
| Retail Subscription | subscriptions | retail_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | Compare Tool |
| Total Subscription | subscriptions | total_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | Compare Tool |
| Current GMP | ipos | gmp | NUMERIC(10,2) | Chittorgarh(4) | Compare Tool |
| P/E Ratio | financial_data | pe_ratio | NUMERIC(10,2) | Prospectus Documents | Compare Tool |
| ROE (%) | financial_data | roe | NUMERIC(5,2) | Prospectus Documents | Compare Tool |
| Revenue Growth CAGR | financial_data | Calculated from revenue_fy fields | NUMERIC(5,2) | Calculated | Compare Tool |
| EPS | financial_data | eps | NUMERIC(10,2) | Prospectus Documents | Compare Tool |
| IPODhan Rating | ipos | rating, rating_rationale | INTEGER, TEXT | Internal Rating Algorithm | Compare Tool |

---

## OFS - Offer for Sale (/ofs)

### OFS Listings Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name (WHERE category='FPO' or similar) | VARCHAR(255) | NSE(1), BSE(2) | OFS Page |
| Non Retail Date | ipos | open_date | DATE | NSE(1), BSE(2) | OFS Page |
| Retail Date | ipos | close_date or custom field | DATE | NSE(1), BSE(2) | OFS Page |

---

## NCD - Non-Convertible Debentures (/ncd)

### NCD Listings Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name (WHERE category='NCD') | VARCHAR(255) | NSE(1), BSE(2) | NCD Page |
| Open Date | ipos | open_date | DATE | NSE(1), BSE(2) | NCD Page |
| Close Date | ipos | close_date | DATE | NSE(1), BSE(2) | NCD Page |

---

## Rights Issues (/rights-issues)

### Upcoming Rights Issues Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name (WHERE category='RIGHTS') | VARCHAR(255) | NSE(1), BSE(2) | Rights Issues Page |
| Record Date | ipo_details or ipos | Custom date field | DATE | NSE(1), BSE(2) | Rights Issues Page |
| Open Date | ipos | open_date | DATE | NSE(1), BSE(2) | Rights Issues Page |
| Renunciation Date | ipo_details or ipos | Custom date field | DATE | NSE(1), BSE(2) | Rights Issues Page |

### Live Rights Issues Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Issuer Company | ipos | company_name (WHERE category='RIGHTS' AND status='OPEN') | VARCHAR(255) | NSE(1), BSE(2) | Rights Issues Page |
| Record Date | ipo_details or ipos | Custom date field | DATE | NSE(1), BSE(2) | Rights Issues Page |
| Open Date | ipos | open_date | DATE | NSE(1), BSE(2) | Rights Issues Page |
| Renunciation Date | ipo_details or ipos | Custom date field | DATE | NSE(1), BSE(2) | Rights Issues Page |

---

## FPO Listings (/fpo-listings)

### Summary Statistics
*Card Metrics*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Total FPOs | ipos | COUNT(*) WHERE category='FPO' | - | Calculated | FPO Listings |
| Avg Listing Gain | listing_performance | AVG(listing_gain_percent) | - | Calculated | FPO Listings |
| Gainers | listing_performance | COUNT(*) WHERE listing_gain_percent > 0 | - | Calculated | FPO Listings |
| Losers | listing_performance | COUNT(*) WHERE listing_gain_percent < 0 | - | Calculated | FPO Listings |

### FPO Listings Table (19 columns)
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company Name | ipos | company_name, category | VARCHAR(255) | NSE(1), BSE(2) | FPO Listings |
| Issue Open | ipos | open_date | DATE | NSE(1), BSE(2) | FPO Listings |
| Issue Close | ipos | close_date | DATE | NSE(1), BSE(2) | FPO Listings |
| Listing Date | ipos | listing_date | DATE | NSE(1), BSE(2) | FPO Listings |
| Issue Price | ipos | price_band_high | NUMERIC(10,2) | NSE(1), BSE(2) | FPO Listings |
| Issue Size (Cr) | ipos | issue_size | NUMERIC(12,2) | NSE(1), BSE(2) | FPO Listings |
| Lot Size | ipos | lot_size | INTEGER | NSE(1), BSE(2) | FPO Listings |
| Overall Subscription | subscriptions | total_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | FPO Listings |
| QIB | subscriptions | qib_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | FPO Listings |
| NII | subscriptions | nii_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | FPO Listings |
| Retail | subscriptions | retail_subscription | NUMERIC(10,2) | NSE(1), BSE(2) | FPO Listings |
| GMP | ipos | gmp | NUMERIC(10,2) | Chittorgarh(4) | FPO Listings |
| Allotment Date | ipos | allotment_date | DATE | NSE(1), BSE(2) | FPO Listings |
| Listing Close | listing_performance | listing_price | INTEGER | Historical Scraper | FPO Listings |
| Listing Gain % | listing_performance | listing_gain_percent | NUMERIC(5,2) | Calculated | FPO Listings |
| Current Price BSE | listing_performance | current_price_bse | INTEGER | Historical Scraper | FPO Listings |
| Current Price NSE | listing_performance | current_price_nse | INTEGER | Historical Scraper | FPO Listings |
| Current Gain % | listing_performance | current_gain_percent | NUMERIC(5,2) | Calculated | FPO Listings |
| Market Cap (Cr) | listing_performance or calculated | Calculated field | NUMERIC | Calculated | FPO Listings |

---

## Mainboard IPO Listings (/mainboard-ipo-listings)

### Summary Statistics
*Card Metrics*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Total IPOs | ipos | COUNT(*) WHERE category='MAINBOARD' AND status='LISTED' | - | Calculated | Mainboard Listings |
| Avg Listing Gain | listing_performance | AVG(listing_gain_percent) | - | Calculated | Mainboard Listings |
| Gainers | listing_performance | COUNT(*) WHERE listing_gain_percent > 0 | - | Calculated | Mainboard Listings |
| Losers | listing_performance | COUNT(*) WHERE listing_gain_percent < 0 | - | Calculated | Mainboard Listings |

### Mainboard Listings Table (19 columns)
*Table Columns* - Same structure as FPO Listings table above

---

## SME IPO Listings (/sme-ipo-listings)

### Summary Statistics
*Card Metrics*

| UI Metric | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Total IPOs | ipos | COUNT(*) WHERE category='SME' AND status='LISTED' | - | Calculated | SME Listings |
| Avg Listing Gain | listing_performance | AVG(listing_gain_percent) | - | Calculated | SME Listings |
| Gainers | listing_performance | COUNT(*) WHERE listing_gain_percent > 0 | - | Calculated | SME Listings |
| Losers | listing_performance | COUNT(*) WHERE listing_gain_percent < 0 | - | Calculated | SME Listings |

### SME Listings Table (19 columns)
*Table Columns* - Same structure as FPO Listings table above

---

## Historical IPOs (/history)

### Historical IPO Table
*Table Columns*

| UI Column | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|-----------|----------|-----------|------|----------------|-----------------|
| Company | ipos | company_name, category | VARCHAR(255) | NSE(1), BSE(2), Historical Scraper | History Page |
| Sector | ipos | sector | VARCHAR(100) | NSE(1), BSE(2) | History Page |
| Issue Price | listing_performance | issue_price | INTEGER | NSE(1), BSE(2), Historical Scraper | History Page |
| Listing Date | ipos | listing_date | DATE | Historical Scraper | History Page |
| Listing Gain (%) | listing_performance | listing_gain_percent | NUMERIC(5,2) | Calculated | History Page |
| Subscription | subscriptions | total_subscription | NUMERIC(10,2) | Historical Scraper | History Page |

---

## IPO Review Detail Page (/ipo-reviews/[reviewId])

### Review Header
*Detail View Fields*

| UI Field Label | DB Table | DB Column | Type | Scrape Sources | Used In Screens |
|----------------|----------|-----------|------|----------------|-----------------|
| Review Title | ipo_reviews | review_title | VARCHAR(500) | Manual Entry, Content Scraper | Review Detail Page |
| IPO Name | ipos | company_name | VARCHAR(255) | NSE(1), BSE(2), Moneycontrol(3), Chittorgarh(4), API_Fallback(5) | Review Detail Page |
| Author | ipo_reviews | author | VARCHAR(255) | Manual Entry, Content Scraper | Review Detail Page |
| Published Date | ipo_reviews | published_date | TIMESTAMP | Manual Entry, Content Scraper | Review Detail Page |
| Recommendation | ipo_reviews | recommendation | ENUM | Manual Entry, Content Scraper | Review Detail Page |
| Review URL | ipo_reviews | review_url | TEXT | Manual Entry, Content Scraper | Review Detail Page |
| Review Content | ipo_reviews | review_content | TEXT | Manual Entry, Content Scraper | Review Detail Page |

---

## Static Content Pages (No Database Mappings)

The following 6 pages are purely static content with no database interactions:

1. **Privacy Policy** (/privacy) - Static legal content
2. **Terms of Service** (/terms) - Static legal content
3. **Disclaimer** (/disclaimer) - Static legal content
4. **About Us** (/about) - Static marketing content
5. **Partner Brokers/Affiliates** (/affiliates) - Static broker comparison (hardcoded array)
6. **Resources** (/resources) - Static educational content (hardcoded arrays)

*Note: These pages contain only hardcoded text and arrays. No database queries or API calls.*

---

## Summary

### Total Screens Mapped: 32

**Data-Driven Pages (26):**
1. **Homepage (/)** - 4 sections
2. **IPO Detail Page (/ipos/[slug])** - 9 sections/tabs
3. **Dashboard (/dashboard)** - Grid/List view with filters
4. **Mainboard IPOs Page (/mainboard-ipos)** - Multiple sections + table
5. **SME IPOs Page (/sme-ipos)** - Multiple sections + table
6. **Mainboard IPO Performance Tracker** - 1 table
7. **SME IPO Performance Tracker** - 1 table
8. **Mainboard IPO Calendar** - Calendar view
9. **SME IPO Calendar** - Calendar view
10. **Mainboard IPO Prospectus** - Document table
11. **SME IPO Prospectus** - Document table
12. **Mainboard IPO Reviews** - Reviews table
13. **SME IPO Reviews** - Reviews table
14. **Market Holidays (/market-holidays)** - Card grid
15. **Registrars Directory (/registrars)** - Table/Cards
16. **Lot Calculator Tool (/tools/lot-calculator)** - Form + Calculator
17. **Compare IPOs Tool (/tools/compare)** - Comparison table (max 3 IPOs)
18. **OFS - Offer for Sale (/ofs)** - 3-column table
19. **NCD - Non-Convertible Debentures (/ncd)** - 3-column table
20. **Rights Issues (/rights-issues)** - 2 tables (Upcoming/Live)
21. **FPO Listings (/fpo-listings)** - 19-column comprehensive table
22. **Mainboard IPO Listings (/mainboard-ipo-listings)** - 19-column table
23. **SME IPO Listings (/sme-ipo-listings)** - 19-column table
24. **Historical IPOs (/history)** - 6-column table
25. **IPO Review Detail Page (/ipo-reviews/[reviewId])** - Detail view
26. **Components Test (/components-test)** - Dev/testing page

**Static Content Pages (6):**
27. **Privacy Policy (/privacy)** - Legal content
28. **Terms of Service (/terms)** - Legal content
29. **Disclaimer (/disclaimer)** - Legal content
30. **About Us (/about)** - Marketing content
31. **Partner Brokers/Affiliates (/affiliates)** - Broker comparison
32. **Resources (/resources)** - Educational content

### Core Database Tables Used

1. **ipos** - Main IPO data (company, dates, prices, status, category)
2. **subscriptions** - Time-series subscription data (QIB, NII, Retail)
3. **gmp_records** - Time-series GMP tracking
4. **financial_data** - Financial metrics (revenue, profit, ratios)
5. **listing_performance** - Listing and current performance
6. **documents** - IPO documents (DRHP, RHP, Prospectus)
7. **market_holidays** - Trading holidays
8. **registrars** - Registrar information
9. **ipo_reviews** - Expert reviews and recommendations

### Scrape Source Priority Legend

- **NSE(1)** - Primary source for NSE-listed IPOs
- **BSE(2)** - Primary source for BSE/SME IPOs
- **Moneycontrol(3)** - Aggregator with ratings
- **Chittorgarh(4)** - GMP data specialist
- **API_Fallback(5)** - Fallback when primary sources fail
- **Historical Scraper** - Past IPO performance data (Chittorgarh)
- **Prospectus Scraper** - Document links from NSE/BSE
- **Market Holidays Scraper** - Holiday data from exchanges
- **Registrars Scraper** - Registrar directory data
- **Internal Rating Algorithm** - IPODhan's proprietary rating
- **Calculated** - Derived fields (percentages, counts, aggregations)
- **Manual Entry** - Manually curated content

### Field Usage Patterns

**Most Used Fields Across Screens:**
- `company_name` - Used in 16 screens
- `open_date` - Used in 12 screens
- `close_date` - Used in 12 screens
- `status` - Used in 13 screens
- `category` - Used in 10 screens
- `issue_size` - Used in 9 screens
- `listing_date` - Used in 9 screens
- `price_band_low/high` - Used in 8 screens

**Unique/Specialized Fields:**
- `gmp`, `gmp_percentage` - Only in IPO Detail (GMP Tab) and some lists
- `subscription_*` - Subscription Tab and live IPO cards
- `financial_data.*` - Only in Financials Tab
- `documents.*` - Prospectus pages and IPO Detail
- `ipo_reviews.*` - Reviews pages only
- `market_holidays.*` - Calendar and Market Holidays pages
- `registrars.*` - Registrar pages and IPO Detail

### Data Flow Notes

1. **Primary IPO Data Flow:**
   - NSE/BSE Scrapers → `ipos` table → All list pages
   - Alternative sources (Moneycontrol, Chittorgarh) supplement missing data

2. **GMP Data Flow:**
   - Chittorgarh Scraper → `gmp_records` (time-series) → GMP Tab charts
   - Latest GMP → `ipos.gmp` → Quick display on cards

3. **Subscription Data Flow:**
   - NSE/BSE Scrapers → `subscriptions` (time-series) → Subscription Tab
   - Latest total → Display on IPO cards

4. **Performance Data Flow:**
   - Historical Scraper → `listing_performance` → Performance Tracker pages
   - Calculated fields (gain %) displayed across multiple pages

5. **Documents Flow:**
   - Prospectus Scraper → `documents` table → Documents Tab + Prospectus pages

### Important Notes

1. **Database Schema Source:** Using `web/drizzle/migrations/schema.ts` as the authoritative schema

2. **Field Type Differences:** Some fields have different names in migration schema vs source schema:
   - `price_range_min/max` (source) vs `price_band_low/high` (migration) ✓ Using migration names
   - `company_name` is consistent across both

3. **Calculated Fields:** Many display fields are calculated in real-time:
   - Listing gain percentages
   - Aggregate counts (total IPOs, gains/losses)
   - Average performance metrics

4. **Time-Series Data:** Multiple tables store historical data:
   - `subscriptions` - Subscription snapshots over time
   - `gmp_records` - GMP values over time
   - Charts display this time-series data

5. **Future Enhancements:** Fields that exist in schema but may not be fully populated yet:
   - Alternative data source fields (Moneycontrol, Chittorgarh coverage at 90%)
   - Some historical financial data fields
   - Advanced GMP metrics (kostak_rate, subject_rate)

---

**Document Generated:** 2025-10-14
**Last Updated:** 2025-10-14
**Version:** 2.1 (Complete with Gap Analysis)
**Coverage:** 32 screens (26 data-driven + 6 static), 9 core tables, 100+ unique fields mapped
**Automation Analysis:** 65% fully automated, 20% calculated, 15% manual entry required

---

## Quick Reference

### Screen Count by Category
- **IPO Listing Pages:** 8 (Homepage, Dashboard, Mainboard, SME, Mainboard Listings, SME Listings, FPO Listings, History)
- **IPO Detail Pages:** 2 (IPO Detail, Review Detail)
- **Calendar Pages:** 3 (Mainboard Calendar, SME Calendar, Market Holidays)
- **Performance Trackers:** 2 (Mainboard Tracker, SME Tracker)
- **Document Pages:** 2 (Mainboard Prospectus, SME Prospectus)
- **Review Pages:** 2 (Mainboard Reviews, SME Reviews)
- **Other IPO Categories:** 4 (OFS, NCD, Rights Issues, FPO)
- **Tools:** 2 (Lot Calculator, Compare)
- **Utility Pages:** 1 (Registrars)
- **Static Content:** 6 (Privacy, Terms, Disclaimer, About, Affiliates, Resources)

### Most Complex Pages (by data fields)
1. **FPO/Mainboard/SME Listings** - 19 columns + 4 summary metrics
2. **IPO Detail Page** - 9 sections with 50+ fields
3. **Compare IPOs Tool** - 12 comparison metrics × 3 IPOs
4. **Mainboard/SME IPOs Page** - 8 sections with multiple data types
5. **Dashboard** - 11 filterable fields with search

---

## Analysis: UI Fields Without Scrape Sources

### Fields with NO Scrape Source (Require Manual Entry or Different Data Collection)

#### 1. **Media/Asset Fields - Manual Upload Required**
| UI Field | Screen | Current Status | Recommendation |
|----------|--------|----------------|----------------|
| Company Logo | IPO Detail Page | Manual Upload | Consider scraping from company websites or stock exchanges |
| Registrar Logo | Registrars Page | Manual Upload (logo_url field) | Could scrape from registrar websites |

#### 2. **Algorithm-Generated Fields - Not Scraped**
| UI Field | Screen | Source | Notes |
|----------|--------|--------|-------|
| IPODhan Rating (1-5) | IPO Detail, Dashboard, Compare Tool | Internal Rating Algorithm | Proprietary scoring based on multiple factors |
| Rating Rationale | IPO Detail, Compare Tool | Internal Rating Algorithm | Explanation text for the rating |
| Rating Override Flag | IPO Detail (backend) | Manual Admin Action | Admin can override algorithm rating |

#### 3. **User Input Fields - Not Scraped**
| UI Field | Screen | Type | Purpose |
|----------|--------|------|---------|
| Investment Amount | Lot Calculator | User Input | User enters desired investment |
| IPO Selection (multi-select) | Compare Tool | User Selection | User selects up to 3 IPOs to compare |
| Search Queries | Multiple pages | User Input | Search/filter functionality |
| Year Filters | Multiple pages | User Selection | Filter data by year |

#### 4. **Calculated/Derived Fields - Not Scraped**
| UI Field | Formula/Calculation | Screens | Source Data |
|----------|---------------------|---------|-------------|
| Number of Lots | `investment_amount / (price × lot_size)` | Lot Calculator | User input + IPO data |
| Total Shares | `lots × lot_size` | Lot Calculator | Calculated from lots |
| Total Investment | `lots × lot_size × price` | Lot Calculator | Calculated from lots |
| Listing Day Return % | `((listing_price - issue_price) / issue_price) × 100` | Performance Trackers, Listings | listing_performance table |
| Current Gain % | `((current_price - issue_price) / issue_price) × 100` | Performance Trackers, Listings | listing_performance table |
| Revenue Growth CAGR | Calculated from FY revenue fields | Compare Tool | financial_data table |
| Market Cap | `current_price × total_shares` (estimated) | FPO/Listings pages | Calculated field |
| Aggregate Metrics | COUNT(), AVG(), SUM() queries | Multiple summary dashboards | Database aggregations |
| Total IPOs | `COUNT(*) WHERE conditions` | Multiple pages | Database count |
| Avg Listing Gain | `AVG(listing_gain_percent)` | Multiple pages | Database average |
| Gainers Count | `COUNT(*) WHERE gain > 0` | Multiple pages | Database count |
| Losers Count | `COUNT(*) WHERE gain < 0` | Multiple pages | Database count |

#### 5. **Fields with Unclear/Incomplete Scrape Sources**

##### A. Rights Issues Specific Fields (Missing Scrape Implementation)
| UI Field | Screen | Current Mapping | Issue |
|----------|--------|-----------------|-------|
| Record Date | Rights Issues | "Custom date field" - ipo_details or ipos | No specific scrape source identified |
| Renunciation Date | Rights Issues | "Custom date field" - ipo_details or ipos | No specific scrape source identified |

**Recommendation:** Need to identify NSE/BSE scrape source for these Rights Issue-specific dates.

##### B. Financial Data Fields (Manual Extraction from Documents)
| UI Field | Screen | Current Source | Issue |
|----------|--------|----------------|-------|
| Revenue FY 2022/2023/2024 | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Profit FY 2022/2023/2024 | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| EPS | Financials Tab, Compare | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| P/E Ratio | Financials Tab, Compare | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| ROE | Financials Tab, Compare | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Debt to Equity | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Total Assets | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Total Borrowing | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Net Worth | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |
| Reserves and Surplus | Financials Tab | "Prospectus Documents" | Manual extraction from PDF, not automated scraping |

**Recommendation:** These require either:
- Manual data entry from prospectus PDFs
- OCR + AI extraction from PDFs (future enhancement)
- API integration if available from data providers

##### C. Review Content (Partially Manual)
| UI Field | Screen | Current Source | Issue |
|----------|--------|----------------|-------|
| Review Title | Reviews Pages | "Manual Entry, Content Scraper" | Mix of manual and scraped |
| Author | Reviews Pages | "Manual Entry, Content Scraper" | Mix of manual and scraped |
| Recommendation | Reviews Pages | "Manual Entry, Content Scraper" | Mix of manual and scraped |
| Review Content | Review Detail | "Manual Entry, Content Scraper" | Mix of manual and scraped |
| Review URL | Reviews Pages | "Manual Entry, Content Scraper" | Mix of manual and scraped |
| Published Date | Reviews Pages | "Manual Entry, Content Scraper" | Mix of manual and scraped |

**Recommendation:** While some reviews can be scraped from financial websites, many require manual curation or partnerships with content providers.

##### D. Registrar Data (Partially Manual)
| UI Field | Screen | Current Source | Issue |
|----------|--------|----------------|-------|
| Registrar Email | Registrars Page | "Registrars Scraper, Manual Entry" | Mix - some fields not available via scraping |
| Registrar Phone | Registrars Page | "Registrars Scraper, Manual Entry" | Mix - contact info may require manual verification |
| Allotment Check URL | Registrars Page | "Registrars Scraper, Manual Entry" | URLs may change, requires monitoring |
| Registrar Address | Registrars Page | "Registrars Scraper, Manual Entry" | Often requires manual verification |

**Recommendation:** Registrar data is relatively static and may benefit from periodic manual verification rather than automated scraping.

#### 6. **Static Content (Hardcoded, No Database)**
| Page | Content Type | Source |
|------|-------------|--------|
| Privacy Policy | Legal text | Hardcoded in component |
| Terms of Service | Legal text | Hardcoded in component |
| Disclaimer | Legal text | Hardcoded in component |
| About Us | Marketing content | Hardcoded in component |
| Affiliates | Broker comparison | Hardcoded array (6 brokers) |
| Resources | Educational content | Hardcoded arrays (guides, tools, downloads, videos, news) |

**Note:** These pages intentionally don't use database/scraping as content is curated and rarely changes.

---

## Recommendations for Missing Scrape Sources

### Priority 1: Critical Gaps
1. **Financial Data Automation**
   - Implement PDF parsing for prospectus documents
   - Use OCR + AI (GPT-4 Vision or similar) to extract financial tables
   - Alternative: Partner with financial data providers for API access

2. **Rights Issues Dates**
   - Identify NSE/BSE source for Record Date and Renunciation Date
   - Add to Rights Issues scraper implementation

### Priority 2: Enhancement Opportunities
1. **Company Logos**
   - Scrape from NSE/BSE company profiles
   - Fallback to company websites
   - Use placeholder/default logo if unavailable

2. **Registrar Contact Verification**
   - Periodic automated verification of contact details
   - Alert system for broken allotment check URLs
   - Manual review queue for discrepancies

3. **Review Content Aggregation**
   - Partner with financial news websites for API access
   - Implement web scraping for major IPO review sites (with permission)
   - Content licensing agreements

### Priority 3: Future Enhancements
1. **Market Cap Calculation**
   - Get real-time share count data
   - Improve market cap accuracy beyond estimations

2. **Advanced Analytics**
   - Sentiment analysis from news articles
   - Social media sentiment for IPOs
   - Historical pattern recognition

---

## Summary Statistics

### Data Source Breakdown
- **Fully Automated Scraped:** ~65 fields (NSE, BSE, Chittorgarh, Moneycontrol, API Fallback)
- **Calculated/Derived:** ~20 fields (from existing scraped data)
- **Manual Entry Required:** ~15 fields (financial data, logos, some registrar details)
- **Algorithm Generated:** 2 fields (IPODhan Rating & Rationale)
- **User Input:** 3 fields (calculator input, selections, filters)
- **Static Content:** 6 pages (legal/marketing content)

### Automation Coverage
- **Core IPO Data:** 95% automated (NSE/BSE scrapers)
- **Financial Data:** 0% automated (requires manual entry from PDFs)
- **GMP Data:** 90% automated (Chittorgarh scraper - 90% complete per story docs)
- **Subscription Data:** 95% automated (NSE/BSE scrapers)
- **Documents:** 90% automated (Prospectus scraper for URLs)
- **Reviews:** 30% automated (mix of scraping and manual curation)
- **Market Holidays:** 100% automated (NSE/BSE scrapers)
- **Registrar Data:** 60% automated (some fields require manual verification)

### Gap Analysis
**Total UI Fields Displayed:** ~100 unique fields
- **With Automated Scrape Source:** 65 (65%)
- **Calculated from Scraped Data:** 20 (20%)
- **Requiring Manual Entry:** 15 (15%)

**Critical Dependencies for Full Automation:**
1. Financial data extraction from PDFs (15 fields)
2. Rights Issues specific dates (2 fields)
3. Company/Registrar logos (2 fields)
4. Review content partnerships (6 fields)

---

## Comprehensive Mapping Gaps Analysis

This section identifies all discrepancies between the database schema and UI implementation, highlighting opportunities for feature enhancements and data quality improvements.

---

### Part 1: Database Fields NOT Mapped to UI (~120 fields)

#### Critical Missing Features

##### 1. **IPO Scoring System (ipo_scores table) - COMPLETELY UNMAPPED** ⭐⭐⭐

This is a major AI-powered feature that exists in the database but is NOT displayed anywhere:

**Database Fields:**
- `total_score` (INTEGER, 0-100) - Overall IPO quality score
- `fundamental_score` (INTEGER, 0-25) - Financial health score
- `sentiment_score` (INTEGER, 0-25) - Market sentiment score
- `subscription_score` (INTEGER, 0-25) - Demand-based score
- `sector_score` (INTEGER, 0-25) - Sector performance score
- `verdict` (VARCHAR) - APPLY/CONSIDER/SKIP recommendation
- `confidence` (VARCHAR) - HIGH/MEDIUM/LOW confidence level
- `reasoning` (TEXT) - Detailed explanation
- `calculated_at` (TIMESTAMP) - When score was calculated
- `algorithm_version` (VARCHAR) - Version tracking

**Impact:** High-value analytical feature completely hidden from users. This AI scoring system could be a major differentiator but is currently unused in the UI.

**Recommendation:**
- Add score badges to all IPO cards
- Create dedicated "IPODhan Score" section in IPO Detail page
- Show verdict with color coding (green=APPLY, yellow=CONSIDER, red=SKIP)
- Display score breakdown with visual charts
- Add filter by score range on listing pages

---

##### 2. **Peer Company Comparison (peer_companies table) - COMPLETELY UNMAPPED** ⭐⭐⭐

Comparative analysis data exists but not displayed:

**Database Fields:**
- `company_name` (VARCHAR) - Peer company name
- `sector` (VARCHAR) - Peer sector
- `is_listed` (BOOLEAN) - Whether peer is listed
- `pe_ratio` (NUMERIC) - Peer P/E ratio
- `eps` (NUMERIC) - Peer earnings per share
- `diluted_eps` (NUMERIC) - Peer diluted EPS
- `ronw` (NUMERIC) - Return on Net Worth %
- `nav` (NUMERIC) - Net Asset Value
- `pbv_ratio` (NUMERIC) - Price to Book Value ratio
- `financial_statement_type` (ENUM) - CONSOLIDATED/STANDALONE
- `data_source` (VARCHAR) - Source of peer data
- `last_updated` (TIMESTAMP) - Data freshness

**Impact:** Missing competitive benchmarking feature that investors use to evaluate IPO valuations against industry peers.

**Recommendation:**
- Add "Peer Comparison" tab in IPO Detail page
- Display table comparing IPO vs 3-5 peer companies
- Include visual charts for metric comparison
- Highlight where IPO is better/worse than peers

---

##### 3. **Enhanced Financial Data (ipo_financials table) - COMPLETELY UNMAPPED** ⭐⭐

More comprehensive financial metrics than the currently mapped `financial_data` table:

**Database Fields:**
- `revenue_fy1/fy2/fy3` (NUMERIC) - Revenue for 3 fiscal years
- `profit_fy1/fy2/fy3` (NUMERIC) - Profit for 3 fiscal years
- `pe_ratio` (NUMERIC) - Price to Earnings ratio
- `pb_ratio` (NUMERIC) - Price to Book ratio
- `roe_percentage` (NUMERIC) - Return on Equity %
- `roce_percentage` (NUMERIC) - Return on Capital Employed %
- `debt_to_equity` (NUMERIC) - Debt to Equity ratio
- `industry_pe` (NUMERIC) - Industry average P/E
- `peer_companies` (TEXT[]) - Array of peer names
- `financial_year_end` (VARCHAR) - FY end date

**Impact:** Less comprehensive financial analysis than database supports. Missing key valuation metrics like P/B ratio and ROCE.

**Recommendation:**
- Migrate Financials Tab to use `ipo_financials` table
- Add P/B Ratio and ROCE to financial display
- Show industry average P/E for comparison
- Display peer companies list with links

---

##### 4. **Stock Symbol & ISIN - Missing Standard Identifiers** ⭐⭐⭐

**Database Fields:**
- `ipos.symbol` (VARCHAR, 20) - Stock ticker symbol (e.g., "RELIANCE")
- `ipo_details.isin` (VARCHAR, 12) - International Securities Identification Number

**Impact:** Missing standard identifiers that professional investors and traders need. ISIN is critical for international investors.

**Recommendation:**
- Add stock symbol to IPO header prominently
- Include symbol in all IPO tables
- Add ISIN to IPO Detail page
- Enable search by symbol/ISIN

---

##### 5. **Detailed Issue Structure (ipo_details table)** ⭐⭐

**Database Fields:**
- `issue_type` (VARCHAR) - BOOK_BUILDING/FIXED_PRICE/HYBRID
- `fresh_issue` (NUMERIC) - Amount raised as fresh capital
- `ofs_issue` (NUMERIC) - Offer for sale amount
- `cut_off_price` (NUMERIC) - Cut-off price for bidding
- `min_investment` (NUMERIC) - Minimum investment required
- `registrar_link` (VARCHAR) - Direct link to registrar portal

**Impact:** Missing key issue mechanics details that help investors understand the offering structure.

**Recommendation:**
- Add "Issue Structure" section in IPO Details
- Show Fresh Issue vs OFS breakdown as pie chart
- Display issue type as badge
- Show minimum investment prominently
- Link directly to registrar portal

---

##### 6. **Extended Timeline Dates (ipo_details table)** ⭐

**Database Fields:**
- `basis_of_allotment_date` (DATE) - When allotment finalized
- `initiation_of_refunds_date` (DATE) - Refund start date
- `credit_of_shares_date` (DATE) - Shares credited to demat

**Impact:** Incomplete timeline in calendars. These dates are important for investors tracking their applications.

**Recommendation:**
- Add to calendar views
- Include in IPO Detail timeline
- Show countdown/elapsed time indicators

---

##### 7. **Granular Subscription Data (subscriptions table)** ⭐⭐

Currently only 3 categories displayed (QIB, NII, Retail), but 7 more exist:

**Database Fields:**
- `employee_subscription` (NUMERIC) - Employee category
- `anchor_investor_subscription` (NUMERIC) - Anchor investors
- `retail_hni_subscription` (NUMERIC) - Retail HNI
- `retail_others_subscription` (NUMERIC) - Retail others
- `b_nii_subscription` (NUMERIC) - Big NII (bids ≥₹10L)
- `s_nii_subscription` (NUMERIC) - Small NII (bids <₹10L)
- `shares_offered` (BIGINT) - Total shares on offer

**Impact:** Less detailed subscription breakdown than available. Missing institutional vs retail split details.

**Recommendation:**
- Expand Subscription Tab to show all 7 categories
- Add toggle for "Detailed View" vs "Simple View"
- Show anchor investor participation (important signal)
- Display bNII vs sNII breakdown

---

##### 8. **Advanced GMP Metrics (gmp_records table)** ⭐

**Database Fields:**
- `kostak_rate` (INTEGER) - Kostak rate for grey market
- `subject_rate` (INTEGER) - Subject to sauda rate
- `sauda_details` (TEXT) - Trading details

**Impact:** Missing grey market trading details that serious investors use.

**Recommendation:**
- Add to GMP Tab display
- Show with explanatory tooltips
- Include grey market trading volume info

---

##### 9. **GMP Confidence Score (gmp_tracking table)** ⭐

**Database Fields:**
- `confidence_score` (INTEGER, 1-100) - Reliability score
- `source` (VARCHAR) - Data source
- `source_url` (VARCHAR) - Source verification link

**Impact:** No indication of GMP data quality/reliability to users.

**Recommendation:**
- Display confidence indicator (High/Medium/Low)
- Show multiple source aggregation
- Add "Last verified" timestamp

---

##### 10. **Registrar Logos** ⭐

**Database Field:**
- `registrars.logo_url` (TEXT) - Registrar company logo URL

**Impact:** Text-only registrar directory looks unprofessional.

**Recommendation:**
- Display logos in registrar directory grid
- Show on IPO detail page next to registrar name
- Use placeholder for missing logos

---

##### 11. **Broker Affiliates (broker_affiliates table) - COMPLETELY UNMAPPED** ⭐

Database table exists but the Affiliates page uses hardcoded array:

**Database Fields:**
- `broker_name` (VARCHAR) - Broker name
- `broker_logo` (TEXT) - Broker logo URL
- `affiliate_url` (TEXT) - Affiliate tracking link
- `display_text` (VARCHAR) - CTA button text
- `active` (BOOLEAN) - Enable/disable broker
- `display_order` (INTEGER) - Sort order

**Impact:** Static affiliate content instead of dynamic database-driven system. Can't update without code deployment.

**Recommendation:**
- Migrate to database-driven display
- Enable admin panel for broker management
- Add A/B testing for affiliate links
- Track click-through rates

---

#### Duplicate/Alternative Tables Needing Reconciliation

##### GMP Data (3 separate tables!):
1. **`gmp_records`** - Currently mapped, used in UI
2. **`gmp_history`** - Unmapped alternative
3. **`gmp_tracking`** - Unmapped with confidence scores

**Issue:** Unclear which table is canonical. Data may be inconsistent across tables.

**Recommendation:** Consolidate into single source of truth or clarify usage:
- `gmp_records` = Raw scraped data
- `gmp_tracking` = Quality-scored aggregated data (USE THIS)
- `gmp_history` = Deprecated? Or backup?

---

##### Subscription Data (2 separate tables):
1. **`subscriptions`** - Currently mapped, comprehensive
2. **`subscription_data`** - Unmapped, category-based structure

**Issue:** Duplicate data storage. Which one is updated by scrapers?

**Recommendation:** Determine canonical source and deprecate the other, or clarify:
- `subscriptions` = Detailed breakdown (current use)
- `subscription_data` = Legacy/simplified format?

---

##### Financial Data (2 separate tables):
1. **`financial_data`** - Currently mapped (FY2022/2023/2024 naming)
2. **`ipo_financials`** - Unmapped (FY1/FY2/FY3 naming + more metrics)

**Issue:** `ipo_financials` has more comprehensive metrics but is unused.

**Recommendation:** Migrate to `ipo_financials` for:
- More metrics (P/B, ROCE, industry P/E)
- Peer companies array
- Better standardization (FY1/2/3)

---

#### Admin/Internal Fields (Correctly Not Displayed)

These backend fields are appropriately hidden from users:

**System Fields (47 fields):**
- Primary keys (`id`) across all tables
- Foreign keys (`ipo_id`, `user_id`, etc.)
- Timestamps (`created_at`, `updated_at`, `recorded_at`, `last_verified_at`)
- Source tracking (`data_source`, `source`, `algorithm_version`)

**Monitoring/Analytics Tables (Complete tables):**
- `pipeline_status` - Scraper pipeline monitoring
- `scraper_logs` - Detailed execution logs
- `score_history` - Historical score changes over time
- `score_performance` - Prediction accuracy tracking
- `affiliate_clicks` - Click tracking analytics
- `ab_experiments` - A/B testing framework
- `api_keys` - API access management
- `users` - User authentication/accounts
- `user_watchlist` - User saved IPOs

**Status:** ✅ These are correctly unmapped as they're backend/admin/analytics features.

---

### Part 2: UI Fields NOT Mapped to Database (~40 fields)

#### Calculated/Derived Fields (Correctly Not Persisted)

These display fields are computed at runtime from database values:

**1. Lot Calculator:**
- Number of Lots = `investment_amount / (price × lot_size)`
- Total Shares = `lots × lot_size`
- Total Investment = `lots × lot_size × price`
- Calculation Formula = Display string

**2. Performance Metrics:**
- Listing Gain % = `(listing_price - issue_price) / issue_price × 100`
- Current Gain % = `(current_price - issue_price) / issue_price × 100`
- Revenue Growth CAGR = Calculated from `revenue_fy` fields

**3. Aggregate Metrics:**
- Total IPOs = `COUNT(*)`
- Total Gainers = `COUNT(*) WHERE gain > 0`
- Total Losers = `COUNT(*) WHERE gain < 0`
- Average Listing Gain = `AVG(listing_gain_percent)`
- Market Cap = `current_price × total_shares` (estimated)

**4. Time-based:**
- Days Until Close = `close_date - today`
- Days Since Listing = `today - listing_date`
- "Closing Soon" indicators (within 2 days)

**Status:** ✅ Correctly not in database - these are runtime calculations that would become stale if persisted.

---

#### User Input Fields (Correctly Not Persisted)

Form controls and filters that don't need database storage:

**1. Search/Filter Inputs:**
- Search query text
- Year filter selections
- Category filter selections
- Status filter selections
- Sector filter selections
- Sort column/direction

**2. Calculator Inputs:**
- Investment Amount (Lot Calculator)
- Selected IPOs (Compare Tool - max 3)

**Status:** ✅ Correctly not persisted - these are transient UI state that vary per session.

---

#### Presentation-Only Fields (Correctly Not Persisted)

Display elements without database equivalents:

**1. Visual Indicators:**
- Row numbers (#) in tables
- Status badges (OPEN/CLOSED/LISTED)
- Color coding (green for gains, red for losses)
- Icons (trending up/down, calendar, document)
- "Today" badges in calendars
- "Best value" highlights in Compare tool
- "Issue Open" / "Closing Today" badges

**2. Navigation Elements:**
- Breadcrumbs
- Tab selections
- Pagination controls
- Sort indicators (arrows)
- Expand/collapse toggles

**3. Formatted Display:**
- Currency symbols (₹)
- Percentage signs (%)
- Subscription multipliers (x)
- Date formatting ("MMM dd, yyyy")
- Number formatting (commas, decimals)

**Status:** ✅ Correctly not in database - pure presentation layer formatting.

---

#### Static Content (Could Be Database-Driven)

Hardcoded content not from database:

**1. Legal Pages:**
- Privacy Policy text (hardcoded component)
- Terms of Service text (hardcoded component)
- Disclaimer text (hardcoded component)

**2. Marketing Pages:**
- About Us content (hardcoded component)
- Resources content (hardcoded arrays: guides, tools, downloads, videos, news)
- Broker comparison (hardcoded array of 6 brokers)

**3. Help/Info Sections:**
- Educational banners (OFS, NCD, Rights explained)
- "How to Use" instructions
- Calculation formulas
- Tips and guidance text

**Status:** ⚠️ These COULD be database-driven via CMS for easier updates by non-technical staff, but hardcoding is acceptable for legal/marketing content that rarely changes. However, **broker affiliates should definitely be in database** (already has table).

---

## Critical Recommendations (Priority Order)

### ⭐⭐⭐ High Priority - User-Facing Features

#### 1. **Implement IPO Scoring UI System**
**Effort:** Medium | **Impact:** Very High | **Priority:** 1

**Tasks:**
- Display score badges (0-100) on all IPO cards
- Add verdict badges with color coding (APPLY/CONSIDER/SKIP)
- Create "IPODhan Score" section in IPO Detail page with breakdown
- Show confidence indicator (HIGH/MEDIUM/LOW)
- Display reasoning/explanation text
- Add filter by score range (0-25, 26-50, 51-75, 76-100)
- Show score history chart if available

**Value:** This is a major differentiating feature that's completely hidden. AI-powered scoring adds significant value for retail investors.

---

#### 2. **Add Peer Comparison Section**
**Effort:** Medium | **Impact:** High | **Priority:** 2

**Tasks:**
- Add "Peer Comparison" tab in IPO Detail page
- Create comparison table (IPO vs 3-5 peer companies)
- Include metrics: P/E, EPS, ROE, NAV, PBV ratios
- Add visual comparison charts
- Highlight where IPO is better/worse than peers
- Show industry average benchmarks

**Value:** Critical for valuation assessment. Investors need to see how IPO pricing compares to existing companies.

---

#### 3. **Display Stock Symbol & ISIN**
**Effort:** Low | **Impact:** High | **Priority:** 3

**Tasks:**
- Add stock symbol to IPO header (next to company name)
- Include symbol column in all IPO tables
- Add ISIN to IPO Detail page (in details section)
- Enable search by symbol/ISIN
- Show NSE/BSE symbol separately if different

**Value:** Standard identifiers that professional investors expect. Critical for international investors who use ISIN.

---

### ⭐⭐ Medium Priority - Feature Enhancements

#### 4. **Enhance Financial Tab with ipo_financials Data**
**Effort:** Medium | **Impact:** Medium | **Priority:** 4

**Tasks:**
- Migrate from `financial_data` to `ipo_financials` table
- Add P/B Ratio display
- Add ROCE percentage display
- Show industry average P/E for comparison
- Display peer companies list from array
- Add financial year end date

**Value:** More comprehensive financial analysis aids investment decisions.

---

#### 5. **Show Issue Structure Details**
**Effort:** Low | **Impact:** Medium | **Priority:** 5

**Tasks:**
- Add "Issue Structure" section in IPO Details
- Show fresh_issue vs ofs_issue breakdown (pie chart or bar)
- Display issue_type as badge (Book Building/Fixed Price/Hybrid)
- Show min_investment requirement prominently
- Add direct link to registrar_link portal

**Value:** Helps investors understand offering structure and minimum investment.

---

#### 6. **Expand Subscription Breakdown**
**Effort:** Medium | **Impact:** Medium | **Priority:** 6

**Tasks:**
- Show all 7 subscription categories (not just 3)
- Add "Detailed View" toggle
- Display employee_subscription
- Show anchor_investor_subscription (important signal)
- Split NII into bNII vs sNII
- Split Retail into HNI vs Others
- Show shares_offered total

**Value:** More granular subscription data helps assess demand quality.

---

### ⭐ Lower Priority - Nice to Have

#### 7. **Add Extended Timeline Dates**
**Effort:** Low | **Impact:** Low | **Priority:** 7
- Add basis_of_allotment_date, initiation_of_refunds_date, credit_of_shares_date to calendars

#### 8. **Show Advanced GMP Metrics**
**Effort:** Low | **Impact:** Low | **Priority:** 8
- Display kostak_rate, subject_rate, sauda_details with tooltips

#### 9. **Add Registrar Logos**
**Effort:** Low | **Impact:** Low | **Priority:** 9
- Display logos in registrar directory and IPO detail page

#### 10. **Migrate Broker Affiliates to Database**
**Effort:** Low | **Impact:** Low | **Priority:** 10
- Replace hardcoded array with database-driven system

---

### Data Quality & Infrastructure

#### 11. **Reconcile Duplicate Tables**
**Effort:** High | **Impact:** High | **Priority:** Infrastructure

**Tasks:**
- Determine canonical GMP table (recommend: `gmp_tracking`)
- Consolidate or clarify subscription tables
- Migrate to `ipo_financials` from `financial_data`
- Document table usage in developer docs
- Create migration scripts if needed

**Value:** Reduces confusion, improves data consistency, simplifies maintenance.

---

#### 12. **Add Field Descriptions & Tooltips**
**Effort:** Medium | **Impact:** Medium | **Priority:** UX Enhancement

**Tasks:**
- Add tooltips for technical terms (RONW, ISIN, bNII, kostak, etc.)
- Create help icon system
- Add "What is this?" links
- Create glossary page

**Value:** Makes platform more accessible to retail investors unfamiliar with financial terminology.

---

### Future - Admin Features

#### 13. **Admin Dashboard**
**Effort:** High | **Impact:** Low (admin only) | **Priority:** Future

**Tasks:**
- Pipeline monitoring UI (`pipeline_status` table)
- Scraper logs viewer (`scraper_logs` table)
- A/B test manager (`ab_experiments` table)
- User analytics dashboard
- API key management UI

**Value:** Internal tooling for operations team. Not user-facing.

---

## Summary Statistics

### Gap Analysis Overview

**Database Fields NOT in UI:** ~120 fields
- **Critical user features:** 60+ fields (8 complete tables unmapped)
  - `ipo_scores` table (8 fields)
  - `peer_companies` table (10 fields)
  - `ipo_financials` table (14 fields)
  - `broker_affiliates` table (4 fields)
  - `score_history` table (8 fields)
  - Plus 20+ individual fields in partially-mapped tables
- **Duplicate/alternative data:** 30+ fields (reconciliation needed)
  - 3 GMP tables, 2 subscription tables, 2 financial tables
- **Admin/internal:** 30+ fields (correctly hidden)
  - System fields, monitoring tables, analytics

**UI Fields NOT in Database:** ~40 fields
- **Calculated fields:** 15 fields (✅ correct - runtime calculations)
- **User input fields:** 10 fields (✅ correct - transient UI state)
- **Presentation fields:** 10 fields (✅ correct - formatting layer)
- **Static content:** 5 areas (⚠️ could be improved for broker affiliates)

### Impact Assessment

**Gap Impact Severity:**
- **🔴 HIGH:** IPO scoring system completely hidden (major feature)
- **🔴 HIGH:** Peer comparison data unused (critical for valuation)
- **🟡 MEDIUM:** Enhanced financial metrics unavailable (ipo_financials)
- **🟡 MEDIUM:** Granular subscription data not shown (7 categories)
- **🟡 MEDIUM:** Stock symbol & ISIN missing (standard identifiers)
- **🟢 LOW:** Minor fields like logos, extended dates, advanced GMP metrics

### Completion Percentage

**Overall Database-to-UI Mapping:**
- **Core IPO Data:** ~80% mapped (good coverage)
- **Advanced Features:** ~40% mapped (significant gaps)
- **Financial Data:** ~60% mapped (moderate coverage)
- **Admin/Internal:** 0% mapped (✅ correct - should be hidden)
- **Overall User-Facing Fields:** ~65% displayed in UI

**Automation Coverage:**
- **Fully Automated Scraped:** 65% (NSE, BSE, Chittorgarh, Moneycontrol, API)
- **Calculated/Derived:** 20% (from scraped data)
- **Manual Entry Required:** 15% (financial data from PDFs, logos)

---

## Conclusion

The IPODhan platform has **significant untapped potential** in its database schema. The most critical gap is the **AI-powered IPO scoring system** (`ipo_scores` table) which is completely implemented in the backend but hidden from users. This alone could be a major differentiator.

Implementing the top 3 recommendations (IPO Scoring UI, Peer Comparison, and Stock Symbols) would significantly enhance the user experience and competitive positioning of the platform.

The analysis also reveals opportunities for data quality improvements through consolidation of duplicate tables and better utilization of existing comprehensive data structures like `ipo_financials` over the more limited `financial_data` table.
