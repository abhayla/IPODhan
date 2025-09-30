# IPODhan UI/UX Wireframes & Design Specifications

## Design System Foundation

### Color Palette
```css
/* Primary Colors */
--primary-green: #10B981;        /* Success, Buy, Positive */
--primary-red: #EF4444;          /* Danger, Sell, Negative */
--primary-blue: #3B82F6;         /* Info, Links, Primary Actions */
--primary-purple: #8B5CF6;       /* Premium features */

/* Neutral Colors */
--gray-900: #111827;              /* Primary text */
--gray-700: #374151;              /* Secondary text */
--gray-500: #6B7280;              /* Muted text */
--gray-300: #D1D5DB;              /* Borders */
--gray-100: #F3F4F6;              /* Backgrounds */
--white: #FFFFFF;                 /* Base white */

/* Dark Mode */
--dark-bg: #0F172A;               /* Dark background */
--dark-card: #1E293B;             /* Card background */
--dark-border: #334155;           /* Dark borders */
```

### Typography
```css
/* Font Family */
--font-primary: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Courier New', monospace;

/* Font Sizes */
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */
```

### Spacing System
```css
/* Based on 4px grid */
--space-1: 0.25rem;    /* 4px */
--space-2: 0.5rem;     /* 8px */
--space-3: 0.75rem;    /* 12px */
--space-4: 1rem;       /* 16px */
--space-5: 1.25rem;    /* 20px */
--space-6: 1.5rem;     /* 24px */
--space-8: 2rem;       /* 32px */
--space-10: 2.5rem;    /* 40px */
--space-12: 3rem;      /* 48px */
--space-16: 4rem;      /* 64px */
```

---

## 1. Homepage Dashboard

### Layout Structure
```
┌─────────────────────────────────────────────────────────────────┐
│  Header Navigation                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Logo | Live IPOs | Upcoming | GMP | Tools | ○ Search | ☰ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Hero Section                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📈 Track Live IPOs & Grey Market Premium                 │  │
│  │  Real-time subscription status, GMP tracking & more       │  │
│  │  [Get Started] [Watch Demo]                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Quick Stats Bar                                                │
│  ┌─────────┬─────────┬─────────┬─────────┬─────────────────┐  │
│  │ Live    │ Closing │ Upcoming│ Listed  │ Avg GMP         │  │
│  │ 5 IPOs  │ Today 2 │ 12 IPOs │ Today 3 │ ₹45 (+12%)     │  │
│  └─────────┴─────────┴─────────┴─────────┴─────────────────┘  │
│                                                                  │
│  Filter Bar                                                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ▼ Category  ▼ Exchange  ▼ Price Range  ▼ Sector  🔍     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Main Content Area                                              │
│  ┌────────────────────────────┬──────────────────────────────┐ │
│  │  Live IPOs Section (70%)   │  Sidebar (30%)               │ │
│  │  ┌──────────────────────┐  │  ┌────────────────────────┐ │ │
│  │  │  IPO Card 1          │  │  │ Top GMP Gainers        │ │ │
│  │  │  ├─ Company Name     │  │  │ 1. Company A  +₹120   │ │ │
│  │  │  ├─ Price: ₹300-320  │  │  │ 2. Company B  +₹95    │ │ │
│  │  │  ├─ Opens: Today     │  │  │ 3. Company C  +₹80    │ │ │
│  │  │  ├─ Subscription: 2x │  │  └────────────────────────┘ │ │
│  │  │  └─ [View] [Track]   │  │                              │ │
│  │  └──────────────────────┘  │  ┌────────────────────────┐ │ │
│  │                             │  │ Quick Tools            │ │ │
│  │  ┌──────────────────────┐  │  │ • Allotment Checker    │ │ │
│  │  │  IPO Card 2          │  │  │ • Returns Calculator   │ │ │
│  │  └──────────────────────┘  │  │ • Compare Brokers      │ │ │
│  │                             │  └────────────────────────┘ │ │
│  └────────────────────────────┴──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Specifications

#### IPO Card Component
```
┌─────────────────────────────────────────┐
│  ┌─────┐  Company Name Ltd.      ★ 4.2 │
│  │Logo │  Mainboard | NSE & BSE         │
│  └─────┘  Technology Sector              │
│ ─────────────────────────────────────── │
│  Price Band:        ₹280 - ₹300         │
│  Lot Size:          50 shares           │
│  Min Investment:    ₹15,000             │
│ ─────────────────────────────────────── │
│  📅 Opens:  Jan 15  |  Closes: Jan 17   │
│ ─────────────────────────────────────── │
│  Subscription Status    [LIVE]           │
│  ┌─────────────────────────────────┐    │
│  │ ████████░░░░░░░  2.3x           │    │
│  └─────────────────────────────────┘    │
│  Retail: 3.2x | QIB: 1.8x | NII: 2.1x   │
│ ─────────────────────────────────────── │
│  GMP: +₹45 (15%)  📈 Expected: ₹345     │
│ ─────────────────────────────────────── │
│  [View Details]  [Track]  [Apply Now]   │
└─────────────────────────────────────────┘
```

---

## 2. IPO Detail Page

### Layout Structure
```
┌─────────────────────────────────────────────────────────────────┐
│  Breadcrumb: Home > Live IPOs > Company Name Ltd                │
│                                                                  │
│  Company Header Section                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [Logo]  Company Name Ltd.                    [Track] ☆  │  │
│  │          Building tomorrow's technology                   │  │
│  │          Mainboard | NSE & BSE | Technology Sector       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Key Metrics Bar                                                │
│  ┌─────────┬──────────┬──────────┬──────────┬─────────────┐  │
│  │ Price   │ Lot Size │ GMP      │ Opens    │ Status      │  │
│  │ ₹280-300│ 50 shares│ +₹45(15%)│ Jan 15   │ LIVE        │  │
│  └─────────┴──────────┴──────────┴──────────┴─────────────┘  │
│                                                                  │
│  Tab Navigation                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Overview | Subscription | GMP | Financials | Documents   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Content Area (Overview Tab)                                    │
│  ┌────────────────────────────┬──────────────────────────────┐ │
│  │  Main Content (65%)        │  Sidebar (35%)               │ │
│  │                             │                              │ │
│  │  About the IPO              │  Quick Actions               │ │
│  │  ┌──────────────────────┐  │  ┌────────────────────────┐ │ │
│  │  │ Company description   │  │  │ [📥 Download RHP]      │ │ │
│  │  │ and key highlights    │  │  │ [🔔 Set Alert]         │ │ │
│  │  └──────────────────────┘  │  │ [📊 View Subscription]  │ │ │
│  │                             │  │ [💰 Apply via Broker]  │ │ │
│  │  IPO Details                │  └────────────────────────┘ │ │
│  │  ┌──────────────────────┐  │                              │ │
│  │  │ Issue Size: ₹3500 Cr │  │  Important Dates             │ │
│  │  │ Fresh Issue: ₹2000 Cr│  │  ┌────────────────────────┐ │ │
│  │  │ OFS: ₹1500 Cr       │  │  │ Open: Jan 15, 2025     │ │ │
│  │  └──────────────────────┘  │  │ Close: Jan 17, 2025    │ │ │
│  │                             │  │ Allotment: Jan 20      │ │ │
│  │  Objects of Issue           │  │ Listing: Jan 23        │ │ │
│  │  ┌──────────────────────┐  │  └────────────────────────┘ │ │
│  │  │ • Working Capital 40% │  │                              │ │
│  │  │ • Debt Payment 30%   │  │  Lead Managers               │ │
│  │  │ • Expansion 30%      │  │  ┌────────────────────────┐ │ │
│  │  └──────────────────────┘  │  │ • ICICI Securities     │ │ │
│  │                             │  │ • Axis Capital         │ │ │
│  └────────────────────────────┴  └────────────────────────┘ │ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Live Subscription Tracker

### Real-time Subscription Widget
```
┌─────────────────────────────────────────────────────────────┐
│  Live Subscription Status         Last Updated: 2 mins ago   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Overall Subscription                                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ██████████████████████░░░░░░░░  5.23x               │  │
│  │  52,30,000 shares / 10,00,000 shares                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Category-wise Breakdown                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Retail (35%)                                         │  │
│  │  ████████████████████████████  8.45x                 │  │
│  │                                                        │  │
│  │  QIB (50%)                                            │  │
│  │  ████████████░░░░░░░░░░░░░░░  3.21x                 │  │
│  │                                                        │  │
│  │  NII (15%)                                            │  │
│  │  ██████████████████░░░░░░░░░  4.67x                 │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Day-wise Trend                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │   10x ┤                                               │  │
│  │    8x ┤                                    ╱          │  │
│  │    6x ┤                              ╱────            │  │
│  │    4x ┤                        ╱────                  │  │
│  │    2x ┤                  ╱────                        │  │
│  │    0x └────┬────┬────┬────┬────┬────                 │  │
│  │         Day 1  Day 2  Day 3  Today                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  [🔄 Auto Refresh ON]  [📊 Detailed View]  [📥 Export]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. GMP Tracker Interface

### GMP Dashboard
```
┌─────────────────────────────────────────────────────────────┐
│  Grey Market Premium Tracker                                │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                              │
│  Current GMP Summary                                        │
│  ┌────────────────────────┬─────────────────────────────┐  │
│  │  Current Premium        │  Expected Listing           │  │
│  │  ┌──────────────────┐  │  ┌───────────────────────┐  │  │
│  │  │   +₹85            │  │  │  ₹385                 │  │  │
│  │  │   28.33%          │  │  │  +28.33% gain         │  │  │
│  │  └──────────────────┘  │  └───────────────────────┘  │  │
│  │                         │                             │  │
│  │  Kostak Rate           │  Confidence                 │  │
│  │  ₹4,250 per lot        │  ⭐⭐⭐⭐ High              │  │
│  └────────────────────────┴─────────────────────────────┘  │
│                                                              │
│  7-Day GMP Trend                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ₹100 ┤                      ╱─────╲                 │  │
│  │   ₹80 ┤                  ╱───        ╲___            │  │
│  │   ₹60 ┤              ╱───                ╲____       │  │
│  │   ₹40 ┤          ╱───                         ╲     │  │
│  │   ₹20 ┤      ╱───                                   │  │
│  │    ₹0 └───┬───┬───┬───┬───┬───┬───                  │  │
│  │        -7d  -5d  -3d  -1d  Today                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
│  Market Comparison                                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Company A  ████████████████████  +₹120 (40%)       │  │
│  │  Company B  ██████████████  +₹85 (28%)   <- You     │  │
│  │  Company C  ████████  +₹45 (15%)                    │  │
│  │  Company D  ████  +₹20 (6%)                         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Mobile Responsive Views

### Mobile IPO Card (375px width)
```
┌─────────────────────────┐
│  Company Name Ltd       │
│  Mainboard | ₹280-300   │
│ ─────────────────────── │
│  📅 Jan 15-17 | LIVE    │
│ ─────────────────────── │
│  Subscription           │
│  ████████░░  2.3x       │
│  R: 3.2x Q: 1.8x N: 2.1x│
│ ─────────────────────── │
│  GMP: +₹45 (15%) 📈     │
│ ─────────────────────── │
│  [Details] [Track]      │
└─────────────────────────┘
```

### Mobile Navigation
```
┌─────────────────────────┐
│  ☰  IPODhan  🔍  🔔    │
└─────────────────────────┘

Bottom Tab Bar:
┌─────────────────────────┐
│  🏠  📊  💹  🛠  👤    │
│ Home Live GMP Tools You │
└─────────────────────────┘
```

### Mobile Subscription View
```
┌─────────────────────────┐
│  Live Subscription      │
│  Overall: 5.23x         │
│  ████████████░░         │
│ ─────────────────────── │
│  📊 Category Breakdown  │
│  Retail:    8.45x ████  │
│  QIB:       3.21x ██    │
│  NII:       4.67x ███   │
│ ─────────────────────── │
│  [View Trend] [Refresh] │
└─────────────────────────┘
```

---

## 6. Interactive Components

### Filter Dropdown
```
┌─────────────────────────────────┐
│  ▼ Select Category              │
├─────────────────────────────────┤
│  ○ All IPOs                     │
│  ○ Mainboard                    │
│  ○ SME                          │
│  ─────────────────────────────  │
│  ▼ Price Range                  │
│  ○ Under ₹500                   │
│  ○ ₹500 - ₹1000                │
│  ○ Above ₹1000                  │
│  ─────────────────────────────  │
│  [Apply Filters]  [Clear]       │
└─────────────────────────────────┘
```

### Allotment Checker Form
```
┌──────────────────────────────────────────┐
│  Check IPO Allotment Status              │
│  ──────────────────────────────────────  │
│  Select IPO                               │
│  ┌────────────────────────────────────┐  │
│  │ ▼ Choose IPO...                    │  │
│  └────────────────────────────────────┘  │
│                                           │
│  Enter Details (any one)                 │
│  ┌────────────────────────────────────┐  │
│  │ PAN Number                          │  │
│  │ [ABCDE1234F              ]         │  │
│  └────────────────────────────────────┘  │
│                OR                         │
│  ┌────────────────────────────────────┐  │
│  │ Application Number                   │  │
│  │ [                        ]          │  │
│  └────────────────────────────────────┘  │
│                OR                         │
│  ┌─────────────┬──────────────────────┐  │
│  │ DP ID       │ Client ID             │  │
│  │ [          ]│ [                  ]  │  │
│  └─────────────┴──────────────────────┘  │
│                                           │
│  [🔍 Check Status]                        │
└──────────────────────────────────────────┘
```

### Notification Alert
```
┌────────────────────────────────┐
│  🔔 IPO Alert                  │
│  ──────────────────────────    │
│  XYZ Ltd subscription crossed  │
│  5x! Current: 5.23x            │
│                                │
│  [View Details]  [Dismiss]     │
└────────────────────────────────┘
```

---

## 7. Dashboard Analytics View

### Admin/Premium Dashboard
```
┌─────────────────────────────────────────────────────────────────┐
│  Portfolio Performance Overview                                 │
│  ┌──────────┬──────────┬──────────┬──────────────────────────┐│
│  │ Applied  │ Allotted │ Returns  │ Success Rate             ││
│  │ 25 IPOs  │ 8 IPOs   │ +₹45,230 │ 32%                      ││
│  └──────────┴──────────┴──────────┴──────────────────────────┘│
│                                                                  │
│  Your IPO Journey                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Month  │ Jan │ Feb │ Mar │ Apr │ May │ Jun │ Jul │ Aug │  │
│  │  Applied│  3  │  2  │  4  │  1  │  3  │  2  │  5  │  3  │  │
│  │  Got    │  1  │  0  │  2  │  0  │  1  │  1  │  2  │  1  │  │
│  │  Returns│ +12%│  -  │ +8% │  -  │ +15%│ -3% │ +20%│ +5% │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Personalized Insights                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 💡 Based on your portfolio:                               │  │
│  │ • You have higher success in Technology sector (45%)     │  │
│  │ • Best returns from ₹500-1000 price range               │  │
│  │ • Consider diversifying into Healthcare IPOs            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Data Tables

### IPO Comparison Table
```
┌────────────────────────────────────────────────────────────────┐
│  Compare IPOs                                    [Add IPO +]   │
├────────────┬───────────┬───────────┬───────────┬─────────────┤
│ Parameter  │ Company A │ Company B │ Company C │             │
├────────────┼───────────┼───────────┼───────────┼─────────────┤
│ Price      │ ₹280-300  │ ₹450-480  │ ₹150-165  │             │
│ Lot Size   │ 50        │ 30        │ 90        │             │
│ Min Invest │ ₹15,000   │ ₹14,400   │ ₹14,850   │             │
│ Issue Size │ ₹3,500 Cr │ ₹2,100 Cr │ ₹850 Cr   │             │
│ GMP        │ +₹45(15%) │ +₹80(17%) │ +₹20(12%) │             │
│ Sub Status │ 2.3x      │ 5.6x      │ 1.8x      │             │
│ P/E Ratio  │ 22.5      │ 28.3      │ 18.9      │             │
│ Opens      │ Jan 15    │ Jan 18    │ Jan 20    │             │
│ Rating     │ ★★★★☆    │ ★★★☆☆    │ ★★★★☆    │             │
└────────────┴───────────┴───────────┴───────────┴─────────────┘
│  [📥 Export Comparison]  [🔗 Share]                            │
└────────────────────────────────────────────────────────────────┘
```

---

## 9. Action Buttons & CTAs

### Primary Actions
```
┌─────────────────┐  ┌─────────────────┐
│   Apply Now     │  │   Track IPO     │
│      ████       │  │       ⭐        │
└─────────────────┘  └─────────────────┘

┌─────────────────┐  ┌─────────────────┐
│  View Details   │  │   Download      │
│       👁        │  │       📥        │
└─────────────────┘  └─────────────────┘
```

### State Variations
```
Default:        [Apply Now]
Hover:          [Apply Now] (elevated shadow)
Loading:        [⟳ Processing...]
Success:        [✓ Applied Successfully]
Disabled:       [Application Closed]
```

---

## 10. Loading States & Empty States

### Loading Skeleton
```
┌─────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░           │
│  ░░░░░░░░░░░░░                 │
│  ──────────────────────────    │
│  ░░░░░░░░░   ░░░░░░░          │
│  ░░░░░░░░░   ░░░░░░░          │
│  ──────────────────────────    │
│  ░░░░░░░░░░░░░░░░░░           │
└─────────────────────────────────┘
```

### Empty State
```
┌─────────────────────────────────┐
│                                  │
│          📭                     │
│                                  │
│    No IPOs Found                │
│                                  │
│  Try adjusting your filters     │
│  or check back later            │
│                                  │
│  [Clear Filters]                │
└─────────────────────────────────┘
```

---

## Implementation Notes

### Responsive Breakpoints
- Mobile: 320px - 768px
- Tablet: 768px - 1024px
- Desktop: 1024px+

### Animation Guidelines
- Page transitions: 200ms ease-in-out
- Hover effects: 150ms ease
- Loading spinners: 1s linear infinite
- Progress bars: 300ms ease-out

### Accessibility Requirements
- WCAG 2.1 AA compliance
- Keyboard navigation support
- Screen reader compatibility
- Focus indicators on all interactive elements
- Minimum touch target: 44x44px

### Performance Targets
- First Contentful Paint: < 1.2s
- Time to Interactive: < 3.5s
- Largest Contentful Paint: < 2.5s
- Cumulative Layout Shift: < 0.1

### Component Library
Recommended: Shadcn/ui with Tailwind CSS
- Consistent design tokens
- Built-in accessibility
- Dark mode support
- Customizable themes

---

## Next Steps

1. **Create Figma/Adobe XD mockups** based on these wireframes
2. **Build component library** with design tokens
3. **Develop interactive prototype** for user testing
4. **Implement responsive layouts** with Tailwind CSS
5. **Add micro-interactions** and animations
6. **Conduct usability testing** with target users
7. **Iterate based on feedback**

---

*These wireframes provide a comprehensive foundation for IPODhan's UI/UX design. Each component is designed with scalability, accessibility, and user experience in mind.*