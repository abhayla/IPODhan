# DataTable Component Usage Map

This document maps all pages in the IPODhan web app that will use the reusable `DataTable` component.

---

## Epic 9: New Pages (Story 9.17)

### **HIGH PRIORITY - Story 9.17 (Current Implementation)**

#### 1. IPO Listings Pages
**Pages:**
- `/mainboard-ipo-listings` - Mainboard IPO post-listing performance
- `/sme-ipo-listings` - SME IPO post-listing performance
- `/fpo-listings` - FPO post-listing performance

**Table Columns (19):**
Company Name, Issue Open, Issue Close, Listing Date, Issue Price, Issue Size, Lot Size, Subscription (Overall/QIB/NII/Retail), GMP, Allotment Date, Listing Day Close Price, Listing Day Gain %, Current Price (BSE/NSE), Current Gain %, Market Cap

**Special Features:**
- Sortable columns (7 columns)
- Color-coded gain/loss percentages
- Company name links to detail page
- Category badges
- Year filter dropdown
- Cross-navigation tabs

---

## Epic 9: Mainboard Category Pages (Stories 9.7a-9.10a)

### **MEDIUM PRIORITY - To Be Implemented**

#### 2. Mainboard IPO Performance Tracker
**Page:** `/mainboard-ipo-performance-tracker`

**Table Columns (7):**
Company Name (expandable), Listed On, Issue Price, Listing Day Close, Listing Day Gain %, Current Price, Profit/Loss %

**Special Features:**
- Year filter
- Color-coded performance metrics
- Expandable IPO Detail and Stock Quotes links
- Filter: category=MAINBOARD only

#### 3. Mainboard IPO Prospectus
**Page:** `/mainboard-ipo-prospectus`

**Table Columns (4):**
Company Name, Exchange, DRHP PDF, RHP PDF

**Special Features:**
- Column-level search
- Sortable columns
- PDF download links
- Total records count
- Pagination (50 per page)
- Filter: category=MAINBOARD only

#### 4. Mainboard IPO Reviews
**Page:** `/mainboard-ipo-reviews`

**Table Columns (5):**
# (Serial), Review Title, Author, Recommendation, IPO

**Special Features:**
- Year navigation
- Column-level search (4 columns)
- Total records count
- Review title links to detail pages
- Sortable columns
- Pagination (50 per page)
- Filter: category=MAINBOARD only

---

## Epic 9: SME Category Pages (Stories 9.11-9.14)

### **MEDIUM PRIORITY - To Be Implemented**

#### 5. SME IPO Performance Tracker
**Page:** `/sme-ipo-performance-tracker`

**Same as Mainboard Performance Tracker**
- Filter: category=SME only

#### 6. SME IPO Prospectus
**Page:** `/sme-ipo-prospectus`

**Same as Mainboard Prospectus**
- Filter: category=SME only

#### 7. SME IPO Reviews
**Page:** `/sme-ipo-reviews`

**Same as Mainboard Reviews**
- Filter: category=SME only

---

## Epic 9: Landing Pages (Stories 9.15-9.16)

### **HIGH PRIORITY - Complex Pages**

#### 8. Mainboard IPOs Landing Page
**Page:** `/mainboard-ipos`

**Detailed Table Section:**
Company, Opening Date, Closing Date, Listing Date, Issue Price, Total Issue Amount, Listing at, Lead Manager, Compare

**Special Features:**
- Minimize/maximize toggle
- Column-level search boxes
- Year navigation
- Status indicators (Issue open, Issue close but not listed, Listing today)
- Sortable columns
- Total records count
- Color-coded rows
- Filter: category=MAINBOARD only

#### 9. SME IPOs Landing Page
**Page:** `/sme-ipos`

**Same as Mainboard Landing Page**
- Filter: category=SME only

---

## Epic 9: Standalone Pages (Stories 9.4-9.6)

### **MEDIUM PRIORITY - Specialized Tables**

#### 10. Rights Issue Page
**Page:** `/rights-issues`

**Table Columns (4):**
Issuer Company, Record Date, Open Date, Renunciation Date

**Special Features:**
- Two tabs: Upcoming | Live
- Tab state in URL query params
- Filter: category=RIGHTS

#### 11. Offer for Sale (OFS) Page
**Page:** `/ofs`

**Table Columns (3):**
Issuer Company, Non Retail Date, Retail Date

**Special Features:**
- Single table view
- Educational banner
- Filter: category=OFS

#### 12. NCD Issue Page
**Page:** `/ncd`

**Table Columns (3):**
Issuer Company, Open Date, Close Date

**Special Features:**
- Sort by Open Date (descending)
- Educational banner
- Filter: category=NCD

---

## Epic 9: Home Page Tables (Stories 9.1-9.3)

### **HIGH PRIORITY - Home Page Enhancement**

#### 13. Home Page IPO Tables (4 Tables)

**Table 1: IPO 2025 List (Mainboard)**
**Columns:** Issuer Company, Open, Close
**Features:** Color-coded rows (green=open, yellow=closing soon)

**Table 2: SME IPO 2025 List**
**Columns:** Issuer Company, Open, Close
**Features:** Same color-coding as Table 1

**Table 3: Upcoming Mainboard IPOs**
**Columns:** Company Name, Status, Date
**Features:** Status badges

**Table 4: Upcoming SME IPOs**
**Columns:** Company Name, Status, Date
**Features:** Status badges

---

## Existing Pages (Can Be Refactored)

### **LOW PRIORITY - Optional Refactoring**

#### 14. Historical IPOs Page
**Page:** `/history`

**Current:** Uses custom `HistoricalIPOTable` component
**Refactor Opportunity:** Can use DataTable with custom columns

**Table Columns:**
Company Name, Listing Date, Issue Price, Listing Price, Listing Gain %, Subscription

**Special Features:**
- Filters: Year, Sector, Performance
- Sort options: Listing Date, Listing Gain %, Subscription
- Pagination (20 per page)
- Card/Table view toggle

#### 15. IPO Comparison Page
**Page:** `/tools/compare`

**Current:** Uses custom `ComparisonTable` component
**Refactor Opportunity:** Can use DataTable for side-by-side comparison

#### 16. Registrar Directory
**Page:** `/registrars`

**Current:** Uses cards
**Enhancement Opportunity:** Add table view toggle option

**Potential Table Columns:**
Registrar Name, Email, Phone, Website, Allotment Check URL

#### 17. Market Holidays
**Page:** `/market-holidays`

**Current:** Uses custom `HolidayCard` component
**Enhancement Opportunity:** Add table view toggle option

**Potential Table Columns:**
Date, Description, Exchange, Type

#### 18. Dashboard
**Page:** `/dashboard`

**Current:** Uses card/grid view
**Enhancement Opportunity:** Add table view toggle option

---

## Future Pages (Image References)

### **FUTURE IMPLEMENTATION**

#### 19. Anchor Investors Analytics
**Reference Image:** `CG-IPO Anchor Investors.png`

**Potential Page:** `/anchor-investors`

**Table Columns:**
Anchor Investor, No. of IPOs, Total Investment, Average Issue Amount, Average P/E, Average Listing Gain %, Average Current Gains %, Average Subscription %

**Special Features:**
- Analytics and trends
- Investor-wise performance tracking

#### 20. IPO Allotment Status
**Reference Image:** `CG-IPO Allotment Status.png`

**Potential Page:** `/allotment-status` or `/tools/allotment-status`

**Table Columns:**
Company Name, Issue Open, Issue Close, Issue Price, Allotment (Status button)

**Special Features:**
- Year filter
- Allotment status indicator
- Direct link to registrar check

---

## Summary by Priority

### **Immediate Implementation (Story 9.17)**
✅ 3 pages - IPO Listings (Mainboard, SME, FPO)

### **Epic 9 - Phase 1 (Stories 9.1-9.6)**
- 4 Home page tables
- 3 Standalone pages (Rights, OFS, NCD)
**Total:** 7 pages

### **Epic 9 - Phase 2 (Stories 9.7a-9.14)**
- 8 Category-specific pages (4 Mainboard + 4 SME)
**Total:** 8 pages

### **Epic 9 - Phase 3 (Stories 9.15-9.16)**
- 2 Landing pages (Mainboard, SME) with detailed tables
**Total:** 2 pages

### **Existing Pages Refactoring (Optional)**
- History, Compare, Registrars, Holidays, Dashboard
**Total:** 5 pages

### **Future Enhancements**
- Anchor Investors, Allotment Status
**Total:** 2 pages

---

## **GRAND TOTAL: 27+ Tables/Pages**

---

## Component Reusability Benefits

By using a single reusable `DataTable` component:

1. **Consistency:** All tables have the same look and feel
2. **Maintainability:** Fix bugs or add features once, applies everywhere
3. **Development Speed:** Configure columns instead of building tables from scratch
4. **Accessibility:** ARIA labels and semantic HTML maintained across all tables
5. **Performance:** Optimizations benefit all pages
6. **Responsive Design:** One responsive solution for all tables
7. **Testing:** Write tests once, validate across all implementations

---

## Next Steps

1. ✅ Finalize DataTable component requirements
2. ✅ Get approval for component design
3. 🔄 Implement generic DataTable component
4. 🔄 Implement render functions library
5. 🔄 Build IPO Listings pages using DataTable
6. 📋 Refactor existing pages to use DataTable (optional)
7. 📋 Implement remaining Epic 9 pages
