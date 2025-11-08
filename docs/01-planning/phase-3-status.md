# Phase 3: User Experience Transformation - Detailed Status

**Phase Timeline**: 12 weeks (60 working days)
**Start Date**: TBD (awaiting Phase 1 & 2 completion)
**Target End Date**: TBD
**Current Status**: NOT STARTED
**Last Updated**: 2025-11-08

---

## Prerequisites (Must be met before starting)

- [ ] Phase 1 complete: Admin consolidation done
- [ ] Phase 2 deployed: Data flow in production (100% traffic)
- [ ] Data accuracy verified: ≥95% quality
- [ ] DRHP extraction operational: 80%+ coverage
- [ ] Source tracking functional: 100% field attribution
- [ ] Conflict rate: <5%
- [ ] Performance benchmarks met: P95 <5s

---

## Weeks 8-9: Visual Identity (2 weeks)

### Design System Foundation ⏸️ BLOCKED
**Status**: WAITING (Phase 1 & 2 not complete)
**Timeline**: 2 weeks
**Owner**: TBD

#### Week 8: Color & Typography

**8.1 Define premium color palette**
- [ ] Status: NOT STARTED
- [ ] Research competitor designs (Bloomberg, Zerodha, Groww)
- [ ] Create color system:
  - [ ] Primary: Professional blue (#0066CC or similar)
  - [ ] Secondary: Accent green for positive (#10B981)
  - [ ] Accent: Orange/yellow for warnings (#F59E0B)
  - [ ] Semantic colors:
    - [ ] Success: Green (#10B981)
    - [ ] Warning: Yellow (#F59E0B)
    - [ ] Error: Red (#EF4444)
    - [ ] Info: Blue (#3B82F6)
  - [ ] Neutral palette: 10 shades of gray
  - [ ] Background colors for light/dark modes
- [ ] Create Tailwind CSS configuration
- [ ] Test color contrast ratios (WCAG AA minimum)

**8.2 Establish typography hierarchy**
- [ ] Status: NOT STARTED
- [ ] Choose font families:
  - [ ] Heading: Inter, SF Pro Display, or custom
  - [ ] Body: Inter, SF Pro Text, or System UI
  - [ ] Data/numbers: SF Mono, Roboto Mono, or JetBrains Mono
- [ ] Define type scale (6 heading levels + body):
  - [ ] H1: 48px/60px (3rem/3.75rem)
  - [ ] H2: 36px/44px (2.25rem/2.75rem)
  - [ ] H3: 30px/36px (1.875rem/2.25rem)
  - [ ] H4: 24px/32px (1.5rem/2rem)
  - [ ] H5: 20px/28px (1.25rem/1.75rem)
  - [ ] H6: 18px/24px (1.125rem/1.5rem)
  - [ ] Body: 16px/24px (1rem/1.5rem)
  - [ ] Small: 14px/20px (0.875rem/1.25rem)
  - [ ] XSmall: 12px/16px (0.75rem/1rem)
- [ ] Define font weights: Regular (400), Medium (500), Semibold (600), Bold (700)
- [ ] Create Tailwind typography utilities

**8.3 Create component design system**
- [ ] Status: NOT STARTED
- [ ] Button components:
  - [ ] Primary button (solid background, high contrast)
  - [ ] Secondary button (outline, lower emphasis)
  - [ ] Ghost button (text only, minimal)
  - [ ] Danger button (destructive actions, red)
  - [ ] Sizes: xs, sm, md, lg, xl
  - [ ] States: default, hover, active, disabled, loading
- [ ] Form components:
  - [ ] Text input (with label, error state, help text)
  - [ ] Textarea (auto-resize option)
  - [ ] Select dropdown (searchable, multi-select)
  - [ ] Checkbox (with label, indeterminate state)
  - [ ] Radio buttons (with label, group)
  - [ ] Toggle switch
  - [ ] Date picker (calendar interface)
  - [ ] Number input (with increment/decrement)
- [ ] Card components:
  - [ ] IPO card (image, title, status, CTA)
  - [ ] Stat card (metric, change, trend)
  - [ ] Info card (icon, title, description)
- [ ] Table components:
  - [ ] Data table with sorting
  - [ ] Pagination controls
  - [ ] Column filtering
  - [ ] Row selection
  - [ ] Export to CSV
- [ ] Chart placeholders (implemented in Weeks 10-12)

**8.4 Develop brand guidelines document**
- [ ] Status: NOT STARTED
- [ ] Create brand book (Markdown or PDF):
  - [ ] Color palette with hex codes
  - [ ] Typography system
  - [ ] Spacing scale (4px, 8px, 16px, 24px, 32px, 48px, 64px)
  - [ ] Border radius values (none, sm, md, lg, full)
  - [ ] Shadow elevation system
  - [ ] Icon style guide (outline, size, stroke width)
  - [ ] Component usage guidelines
  - [ ] Accessibility requirements
- [ ] Share with team for feedback

**8.5 Create design mockups (OPTIONAL)**
- [ ] Status: NOT STARTED
- [ ] Use Figma, Sketch, or Penpot
- [ ] Mockup key pages:
  - [ ] Homepage
  - [ ] IPO detail page
  - [ ] Calendar page
  - [ ] Compare page
- [ ] Get user feedback on designs

#### Week 9: Implementation

**9.1 Set up Tailwind CSS configuration**
- [ ] Status: NOT STARTED
- [ ] Extend Tailwind config with custom theme:
  - [ ] Colors from palette
  - [ ] Typography scale
  - [ ] Spacing scale
  - [ ] Border radius
  - [ ] Box shadows
  - [ ] Breakpoints (if custom)
- [ ] Configure dark mode: `class` strategy
- [ ] Add CSS custom properties for theme variables
- [ ] Test hot module replacement works

**9.2 Create base component library**
- [ ] Status: NOT STARTED
- [ ] Location: `web/components/ui/` (shadcn/ui pattern)
- [ ] Implement components:
  - [ ] `button.tsx` - All button variants
  - [ ] `input.tsx` - Text input with validation
  - [ ] `select.tsx` - Dropdown select
  - [ ] `checkbox.tsx` - Checkbox with label
  - [ ] `radio-group.tsx` - Radio button group
  - [ ] `switch.tsx` - Toggle switch
  - [ ] `card.tsx` - Card container
  - [ ] `badge.tsx` - Status badges
  - [ ] `alert.tsx` - Alert/notification
  - [ ] `dialog.tsx` - Modal dialog
  - [ ] `dropdown-menu.tsx` - Dropdown menu
  - [ ] `tooltip.tsx` - Hover tooltips
- [ ] Write Storybook stories or demo page
- [ ] Unit tests for interactive components

**9.3 Implement dark mode support**
- [ ] Status: NOT STARTED
- [ ] Add theme toggle in header
- [ ] Persist preference to localStorage
- [ ] System preference detection
- [ ] Smooth transition between themes
- [ ] Test all components in both modes
- [ ] Verify contrast ratios in dark mode

**9.4 Add CSS custom properties**
- [ ] Status: NOT STARTED
- [ ] Define CSS variables in `globals.css`:
  - [ ] `--color-primary`, `--color-secondary`, etc.
  - [ ] `--font-heading`, `--font-body`, `--font-mono`
  - [ ] `--spacing-xs`, `--spacing-sm`, etc.
  - [ ] `--radius-sm`, `--radius-md`, etc.
- [ ] Use variables in Tailwind config
- [ ] Enable runtime theme customization (optional)

**9.5 Build component showcase**
- [ ] Status: NOT STARTED
- [ ] Create `/design-system` route (dev only)
- [ ] Show all components with variants
- [ ] Interactive prop controls
- [ ] Copy code snippets
- [ ] Accessibility checks

---

## Weeks 10-12: Data Visualization (3 weeks)

### Chart Library Integration ⏸️ BLOCKED
**Status**: WAITING (Weeks 8-9 not complete)
**Timeline**: 3 weeks

#### Week 10: Chart Library Setup

**10.1 Evaluate and choose charting library**
- [ ] Status: NOT STARTED
- [ ] Criteria:
  - [ ] React-native (TypeScript support)
  - [ ] Small bundle size (<50KB gzipped)
  - [ ] Customizable styling
  - [ ] Responsive design
  - [ ] Animation support
  - [ ] Accessibility features
- [ ] Options to consider:
  - [ ] Recharts (recommended: React-native, composable)
  - [ ] Chart.js with react-chartjs-2
  - [ ] Victory (granular control, heavier)
  - [ ] D3.js (full control, steep learning curve)
- [ ] Decision: Go with **Recharts** (unless compelling reason otherwise)
- [ ] Install: `npm install recharts`

**10.2 Create reusable chart components**
- [ ] Status: NOT STARTED
- [ ] Base chart wrapper:
  - [ ] Responsive container
  - [ ] Theme integration (colors, fonts)
  - [ ] Loading state
  - [ ] Error state
  - [ ] No data state
  - [ ] Export to PNG (optional)
- [ ] Components to create:
  - [ ] `<LineChart>` - Time series data
  - [ ] `<BarChart>` - Comparison data
  - [ ] `<PieChart>` - Proportion data
  - [ ] `<AreaChart>` - Cumulative data
  - [ ] `<CandlestickChart>` - Price bands (if needed)
- [ ] Location: `web/components/charts/`

**10.3 Implement specific chart use cases**
- [ ] Status: NOT STARTED
- [ ] GMP Trends Chart:
  - [ ] Line chart showing GMP over time
  - [ ] X-axis: Date, Y-axis: GMP value
  - [ ] Tooltip: Date, GMP, Premium %
  - [ ] Color: Green if positive, red if negative
- [ ] Subscription Data Chart:
  - [ ] Stacked bar chart by category (QIB, NII, Retail)
  - [ ] X-axis: Date/time, Y-axis: Subscription times
  - [ ] Legend for categories
  - [ ] Highlight oversubscribed (>1x)
- [ ] Financial Performance Chart:
  - [ ] Multi-line chart: Revenue, Profit, Networth
  - [ ] X-axis: Fiscal year, Y-axis: Amount (₹Cr)
  - [ ] Toggle to show/hide each metric
  - [ ] Comparison with industry average (optional)
- [ ] Portfolio Allocation Chart:
  - [ ] Pie chart: IPOs by segment (Mainboard, SME)
  - [ ] Donut chart variant
  - [ ] Show count and percentage

#### Week 11: Real-time Features

**11.1 Implement WebSocket/SSE for live updates**
- [ ] Status: NOT STARTED
- [ ] Decision: Use **Server-Sent Events (SSE)** for simplicity
  - [ ] One-way communication (server → client)
  - [ ] Automatic reconnection
  - [ ] Standard HTTP (no special proxy config)
- [ ] Alternative: WebSocket if bi-directional needed
- [ ] Create SSE endpoint: `GET /api/sse/subscriptions`
- [ ] Client hook: `useSubscriptionUpdates(ipoId)`
- [ ] Handle connection errors gracefully
- [ ] Fallback to polling if SSE unsupported

**11.2 Add real-time GMP ticker**
- [ ] Status: NOT STARTED
- [ ] Location: Homepage header or sidebar
- [ ] Display: "XYZ IPO: GMP ₹250 (+25%)"
- [ ] Auto-scroll if multiple IPOs
- [ ] Update every 30 seconds
- [ ] Color-coded: Green (up), red (down)

**11.3 Create live IPO status dashboard**
- [ ] Status: NOT STARTED
- [ ] Show IPOs currently OPEN
- [ ] Real-time subscription data updates
- [ ] Countdown timer to close date
- [ ] Visual indicator: "Oversubscribed!" badge
- [ ] Refresh every 10 seconds

**11.4 Build subscription countdown timers**
- [ ] Status: NOT STARTED
- [ ] Component: `<CountdownTimer endDate={...} />`
- [ ] Format: "2d 5h 30m 15s remaining"
- [ ] Color change: Green → Yellow → Red as time runs out
- [ ] Auto-update every second
- [ ] Show "Closed" when time expires

**11.5 Add "last updated" timestamps**
- [ ] Status: NOT STARTED
- [ ] Show on all dynamic data
- [ ] Format: "Updated 5 minutes ago"
- [ ] Use `date-fns` for relative time
- [ ] Auto-refresh indicator (spinning icon)
- [ ] Manual refresh button

#### Week 12: Data Attribution & Confidence

**12.1 Display field-level source badges**
- [ ] Status: NOT STARTED
- [ ] Badge component: `<SourceBadge source="NSE" />`
- [ ] Source types:
  - [ ] NSE (blue, "N")
  - [ ] BSE (green, "B")
  - [ ] DRHP (gold, "D")
  - [ ] Chittorgarh (orange, "C")
  - [ ] Moneycontrol (purple, "M")
  - [ ] Admin (red, "A")
- [ ] Placement: Next to field value (inline or tooltip)
- [ ] Hover: Show full source name + timestamp
- [ ] Use data from `field_sources` table

**12.2 Show DRHP extraction confidence scores**
- [ ] Status: NOT STARTED
- [ ] Confidence levels:
  - [ ] High (≥90%): Green checkmark ✓
  - [ ] Medium (70-89%): Yellow warning ⚠
  - [ ] Low (<70%): Gray, manual verification needed ⓘ
- [ ] Display: Icon next to DRHP-sourced fields
- [ ] Tooltip: "Extracted with 92% confidence from DRHP"
- [ ] Admin option to verify/override low confidence

**12.3 Add "Admin Verified" special badge**
- [ ] Status: NOT STARTED
- [ ] Badge: Red "Verified by Admin" badge
- [ ] Higher visual weight than source badges
- [ ] Use for manually confirmed critical data
- [ ] Check `field_protection` table for admin source

**12.4 Create data quality indicators**
- [ ] Status: NOT STARTED
- [ ] Overall quality score per IPO:
  - [ ] Calculate: % fields with high confidence sources
  - [ ] Display: "Data Quality: 95%" with color bar
  - [ ] Green: ≥90%, Yellow: 70-89%, Red: <70%
- [ ] Field-level warnings:
  - [ ] Missing critical data (lot_size, price band)
  - [ ] Conflicting data from multiple sources
  - [ ] Outdated data (not updated in >7 days)

**12.5 Build conflict notification UI**
- [ ] Status: NOT STARTED
- [ ] Show conflicts from `data_conflicts` table
- [ ] Notification badge: "3 conflicts detected"
- [ ] Conflict detail panel:
  - [ ] Field name
  - [ ] Old value (source + timestamp)
  - [ ] New value (source + timestamp)
  - [ ] Conflict reason (e.g., SOURCE_PRIORITY, TIME_BASED)
  - [ ] Resolution: Kept old / Accepted new
- [ ] Admin action: Manual override if needed

---

## Weeks 13-15: Mobile Experience (3 weeks)

### Mobile-First Redesign ⏸️ BLOCKED
**Status**: WAITING (Weeks 10-12 not complete)
**Timeline**: 3 weeks

#### Week 13: Mobile Audit & Redesign

**13.1 Audit current mobile experience**
- [ ] Status: NOT STARTED
- [ ] Test on devices:
  - [ ] iOS: iPhone 14, iPhone SE, iPad
  - [ ] Android: Samsung Galaxy, Pixel, Tablet
- [ ] Test on browsers:
  - [ ] iOS Safari
  - [ ] Android Chrome
  - [ ] Firefox Mobile
- [ ] Identify pain points:
  - [ ] Navigation: Hard to access menu?
  - [ ] Tables: Horizontal scroll issues?
  - [ ] Forms: Input too small?
  - [ ] CTAs: Buttons too small to tap?
  - [ ] Load time: Slow on 3G/4G?
- [ ] Document issues with screenshots

**13.2 Redesign homepage for mobile**
- [ ] Status: NOT STARTED
- [ ] Layout: Card-based, vertical stack
- [ ] Hero section: Simplified, single CTA
- [ ] IPO cards: Swipeable horizontal carousel
- [ ] Filters: Collapsible panel (drawer)
- [ ] Search: Sticky header, easily accessible
- [ ] Performance: Lazy load images, defer non-critical JS

**13.3 Redesign IPO detail page for mobile**
- [ ] Status: NOT STARTED
- [ ] Tabs: Horizontal scrolling tabs (sticky)
- [ ] Sections: Collapsible accordions
- [ ] Data tables: Card layout instead of table
- [ ] Charts: Responsive, fill container width
- [ ] CTAs: Fixed bottom bar (Apply Now, etc.)
- [ ] Sharing: Native share API integration

**13.4 Redesign Compare page for mobile**
- [ ] Status: NOT STARTED
- [ ] Layout: Vertical comparison (stacked cards)
- [ ] Toggle: Switch between IPOs (dropdown)
- [ ] Tables: Horizontal scroll with sticky first column
- [ ] Remove: Easy swipe to remove IPO
- [ ] Add: Floating action button (FAB)

**13.5 Redesign Calendar page for mobile**
- [ ] Status: NOT STARTED
- [ ] Views: Month / Week / Day toggle
- [ ] Month view: Compact, date numbers only
- [ ] Day view: Timeline with IPO events
- [ ] Navigation: Swipe left/right for prev/next
- [ ] Event details: Bottom sheet on tap

#### Week 14: Touch Optimizations

**14.1 Larger tap targets**
- [ ] Status: NOT STARTED
- [ ] Minimum size: 44x44px (iOS) or 48x48px (Android)
- [ ] Add padding to buttons/links
- [ ] Increase spacing between tappable elements
- [ ] Test with accessibility inspector

**14.2 Swipe gestures for navigation**
- [ ] Status: NOT STARTED
- [ ] Swipe right: Go back (browser back)
- [ ] Swipe left/right on carousel: Next/prev item
- [ ] Swipe down on modal: Dismiss
- [ ] Pull down on list: Refresh
- [ ] Use library: `react-swipeable` or native

**14.3 Pull-to-refresh on lists**
- [ ] Status: NOT STARTED
- [ ] Implement on:
  - [ ] Homepage IPO list
  - [ ] Calendar events
  - [ ] Watchlist
  - [ ] Notifications
- [ ] Visual feedback: Spinner or custom animation
- [ ] Haptic feedback (if supported)

**14.4 Touch-friendly form inputs**
- [ ] Status: NOT STARTED
- [ ] Input size: Larger height (48px minimum)
- [ ] Labels: Above input, not placeholder
- [ ] Error messages: Below input, red text
- [ ] Autocomplete: Enable where appropriate
- [ ] Keyboard type: Numeric for numbers, email for email
- [ ] Date picker: Native date input on mobile

**14.5 Gesture-based interactions**
- [ ] Status: NOT STARTED
- [ ] Pinch to zoom: Charts and images
- [ ] Long press: Show context menu
- [ ] Double tap: Zoom in (optional)
- [ ] Swipe to delete: Watchlist items

#### Week 15: Mobile Performance & PWA

**15.1 Optimize performance for mobile**
- [ ] Status: NOT STARTED
- [ ] Lazy load images: Use `<img loading="lazy">`
- [ ] Responsive images: `srcset` with multiple sizes
- [ ] Code splitting: Split by route
- [ ] Reduce bundle size: Tree-shake unused code
- [ ] Defer non-critical JS: Load below the fold
- [ ] Minify CSS/JS: Ensure production build optimized
- [ ] Target: Lighthouse Performance ≥90 on mobile

**15.2 Implement service worker for offline**
- [ ] Status: NOT STARTED
- [ ] Cache strategy:
  - [ ] App shell: Cache first
  - [ ] API data: Network first, fallback to cache
  - [ ] Images: Cache first, network fallback
- [ ] Offline page: Show when no network
- [ ] Background sync: Queue failed requests
- [ ] Update notification: "New version available"

**15.3 Add PWA manifest.json**
- [ ] Status: NOT STARTED
- [ ] Create `public/manifest.json`:
  - [ ] name: "IPODhan - IPO Information Platform"
  - [ ] short_name: "IPODhan"
  - [ ] description: "Track Indian IPOs..."
  - [ ] theme_color: (primary brand color)
  - [ ] background_color: (background color)
  - [ ] display: "standalone"
  - [ ] start_url: "/"
  - [ ] orientation: "portrait"
- [ ] Link in `<head>`: `<link rel="manifest" href="/manifest.json">`

**15.4 Create app icons**
- [ ] Status: NOT STARTED
- [ ] Sizes needed:
  - [ ] 192x192 (Android home screen)
  - [ ] 512x512 (Android splash screen)
  - [ ] 180x180 (iOS home screen)
  - [ ] 32x32, 16x16 (Favicon)
  - [ ] Others: 144x144, 96x96, 72x72, 48x48
- [ ] Generate from logo using online tool
- [ ] Test on device: "Add to Home Screen"

**15.5 Test PWA installation flow**
- [ ] Status: NOT STARTED
- [ ] Chrome (Android): Install banner appears
- [ ] Safari (iOS): "Add to Home Screen" works
- [ ] Installed app: Opens without browser chrome
- [ ] Splash screen: Displays correctly
- [ ] Offline mode: Works as expected

---

## Weeks 16-17: Personalization (2 weeks)

### User Preferences & Customization ⏸️ BLOCKED
**Status**: WAITING (Weeks 13-15 not complete)
**Timeline**: 2 weeks

#### Week 16: Preferences & Watchlist

**16.1 Create user settings page**
- [ ] Status: NOT STARTED
- [ ] Route: `/settings` or `/account/preferences`
- [ ] Sections:
  - [ ] Appearance (theme, font size)
  - [ ] Default filters (segment, status)
  - [ ] Notifications (email, push, in-app)
  - [ ] Privacy (data sharing, cookies)
- [ ] Save button: Persist to localStorage or DB
- [ ] Reset to defaults option

**16.2 Implement preference persistence**
- [ ] Status: NOT STARTED
- [ ] For anonymous users:
  - [ ] Store in `localStorage`
  - [ ] Sync across tabs using `storage` event
- [ ] For authenticated users:
  - [ ] Store in database (new table: `user_preferences`)
  - [ ] Fetch on login, sync to localStorage
  - [ ] Update via API: `PATCH /api/user/preferences`
- [ ] Fallback: Default preferences if none set

**16.3 Add quick settings toggle in header**
- [ ] Status: NOT STARTED
- [ ] Dropdown menu: Theme, segment filter
- [ ] Quick actions: Toggle dark mode, change default view
- [ ] No page reload required
- [ ] Persist immediately on change

**16.4 Build watchlist functionality**
- [ ] Status: NOT STARTED
- [ ] Add to watchlist: Heart icon on IPO cards
- [ ] Remove from watchlist: Un-heart or swipe to delete
- [ ] Watchlist page: `/watchlist` or `/favorites`
- [ ] Features:
  - [ ] Sort by: Date added, status, subscription
  - [ ] Filter by: Segment, status
  - [ ] Bulk actions: Remove all, export to CSV
- [ ] Anonymous users: localStorage (max 50)
- [ ] Authenticated users: Database (`user_watchlist` table)

**16.5 Watchlist widget on homepage**
- [ ] Status: NOT STARTED
- [ ] Component: `<WatchlistWidget />`
- [ ] Show: Top 5 watchlist IPOs
- [ ] Data: Status, subscription, GMP (if available)
- [ ] CTA: "View All" → `/watchlist`
- [ ] Empty state: "Add IPOs to get started"

#### Week 17: Alerts & Dashboards

**17.1 Implement alerts system**
- [ ] Status: NOT STARTED
- [ ] Alert types:
  - [ ] Status change: IPO opens/closes/lists
  - [ ] Subscription milestone: 50%, 100%, 200%, etc.
  - [ ] GMP change: Significant increase/decrease
  - [ ] Listing date: 1 day before, on listing day
  - [ ] Price change: Listing price vs issue price
- [ ] Delivery methods:
  - [ ] Email: Send via Resend, SendGrid, or SMTP
  - [ ] Browser push: Web Push API
  - [ ] In-app: Notification center
- [ ] User preferences: Choose which alerts to receive
- [ ] Database: `user_alerts`, `alert_logs` tables

**17.2 Create notification center**
- [ ] Status: NOT STARTED
- [ ] Location: Header icon with badge count
- [ ] Dropdown: List of recent notifications
- [ ] Features:
  - [ ] Mark as read/unread
  - [ ] Delete notification
  - [ ] "Mark all as read"
  - [ ] Notification history: `/notifications`
- [ ] Real-time: Use SSE to push new notifications
- [ ] Persistence: Store in database or localStorage

**17.3 Build dashboard builder UI**
- [ ] Status: NOT STARTED
- [ ] Library: Use `react-grid-layout` for drag-and-drop
- [ ] Features:
  - [ ] Drag widgets to rearrange
  - [ ] Resize widgets (1x1, 2x1, 2x2 grid)
  - [ ] Add/remove widgets
  - [ ] Save layout to database or localStorage
- [ ] Route: `/dashboard` or `/my-dashboard`

**17.4 Create dashboard widgets**
- [ ] Status: NOT STARTED
- [ ] Widget types:
  - [ ] Upcoming IPOs (list, configurable count)
  - [ ] Portfolio Performance (chart, P&L summary)
  - [ ] GMP Trends (chart, top movers)
  - [ ] News Feed (latest IPO news, RSS or API)
  - [ ] Market Mood (sentiment indicator, bull/bear)
  - [ ] Subscription Stats (oversubscribed IPOs)
  - [ ] Watchlist Summary (quick view)
- [ ] Widget config: Size, data source, refresh rate
- [ ] Each widget: Loading, error, empty states

**17.5 Enable dashboard sharing (OPTIONAL)**
- [ ] Status: NOT STARTED
- [ ] Generate shareable link: `/dashboard/share/[id]`
- [ ] Public vs private: Toggle in settings
- [ ] Embed code: For websites/blogs
- [ ] Analytics: Track views, interactions

---

## Weeks 18-19: Polish & Launch (2 weeks)

### Final Optimization & QA ⏸️ BLOCKED
**Status**: WAITING (Weeks 16-17 not complete)
**Timeline**: 2 weeks

#### Week 18: Performance & A/B Testing

**18.1 Run Lighthouse audits on all key pages**
- [ ] Status: NOT STARTED
- [ ] Pages to audit:
  - [ ] Homepage: `/`
  - [ ] IPO detail: `/ipo/[slug]`
  - [ ] Calendar: `/calendar`
  - [ ] Compare: `/compare`
  - [ ] Watchlist: `/watchlist`
  - [ ] Dashboard: `/dashboard`
- [ ] Targets:
  - [ ] Performance: ≥90
  - [ ] Accessibility: ≥95
  - [ ] Best Practices: ≥90
  - [ ] SEO: ≥90
- [ ] Fix all issues below target

**18.2 Optimize images**
- [ ] Status: NOT STARTED
- [ ] Convert to WebP format
- [ ] Add lazy loading: `loading="lazy"`
- [ ] Responsive images: `srcset` with 2x, 3x variants
- [ ] Use Next.js `<Image>` component
- [ ] Compress with TinyPNG or ImageOptim
- [ ] Serve from CDN (Cloudflare, Vercel, etc.)

**18.3 Implement CDN for static assets**
- [ ] Status: NOT STARTED
- [ ] Choose CDN: Vercel (default), Cloudflare, Fastly
- [ ] Configure cache headers:
  - [ ] Images: 1 year (`max-age=31536000`)
  - [ ] CSS/JS: 1 year (immutable)
  - [ ] HTML: No cache or short (5 min)
- [ ] Test: Verify assets served from CDN
- [ ] Monitor: CDN hit rate should be >95%

**18.4 Enable compression**
- [ ] Status: NOT STARTED
- [ ] Brotli: Enable in Next.js config (production)
- [ ] Gzip: Fallback for older browsers
- [ ] Test: Check `Content-Encoding` header
- [ ] Target: 70-80% size reduction

**18.5 Add resource hints**
- [ ] Status: NOT STARTED
- [ ] Preconnect: External domains (fonts, analytics)
  - [ ] `<link rel="preconnect" href="https://fonts.googleapis.com">`
- [ ] Preload: Critical resources (fonts, hero images)
  - [ ] `<link rel="preload" href="/fonts/inter.woff2" as="font">`
- [ ] Prefetch: Next page resources (for fast navigation)
  - [ ] `<link rel="prefetch" href="/ipo/xyz">`
- [ ] DNS-prefetch: Early DNS resolution

**18.6 Database query optimization**
- [ ] Status: NOT STARTED
- [ ] Add missing indexes:
  - [ ] Check slow query log
  - [ ] Create indexes for common WHERE clauses
  - [ ] Composite indexes for multi-column filters
- [ ] Optimize N+1 queries:
  - [ ] Use JOINs or eager loading
  - [ ] Batch requests with DataLoader (if needed)
- [ ] Review query execution plans:
  - [ ] Use `EXPLAIN ANALYZE`
  - [ ] Optimize slow queries (>100ms)

**18.7 Verify cache hit rates**
- [ ] Status: NOT STARTED
- [ ] Check Redis metrics:
  - [ ] Cache hit rate: ≥80% target
  - [ ] Cache miss rate: <20%
  - [ ] Eviction rate: Low (if high, increase memory)
- [ ] Adjust TTLs if needed:
  - [ ] Longer for static data
  - [ ] Shorter for dynamic data
- [ ] Monitor cache size and memory usage

**18.8 Choose A/B testing framework**
- [ ] Status: NOT STARTED
- [ ] Options:
  - [ ] Vercel Edge Config (recommended if on Vercel)
  - [ ] PostHog (open-source, self-hosted)
  - [ ] LaunchDarkly (feature flags)
  - [ ] Google Optimize (free, sunsetting 2023)
  - [ ] Custom solution (feature flags in DB)
- [ ] Decision: Use **Vercel Edge Config** or **PostHog**
- [ ] Install and configure

**18.9 Define test hypotheses**
- [ ] Status: NOT STARTED
- [ ] Test ideas:
  - [ ] CTA button color: Blue vs Green
  - [ ] CTA text: "Apply Now" vs "Invest Now" vs "View Details"
  - [ ] Homepage layout: Grid vs List
  - [ ] Pricing table: Highlight recommended vs no highlight (if applicable)
  - [ ] IPO card design: Vertical vs Horizontal
- [ ] Select top 3 to test
- [ ] Define success metrics (CTR, conversion, time on page)

**18.10 Implement feature flags**
- [ ] Status: NOT STARTED
- [ ] Create feature flag service:
  - [ ] `isFeatureEnabled(flag: string): boolean`
  - [ ] Store flags in Edge Config or database
- [ ] Wrap new features in flags:
  - [ ] `if (isFeatureEnabled('new-dashboard')) { ... }`
- [ ] Admin UI: Toggle flags on/off
- [ ] Gradual rollout: 10% → 50% → 100%

**18.11 Set up analytics tracking**
- [ ] Status: NOT STARTED
- [ ] Choose analytics:
  - [ ] Google Analytics 4 (free, powerful)
  - [ ] Plausible (privacy-focused, paid)
  - [ ] Fathom (simple, privacy-focused, paid)
  - [ ] Mixpanel (product analytics, free tier)
- [ ] Decision: Use **Google Analytics 4** (or Plausible for privacy)
- [ ] Install tracking script
- [ ] Configure:
  - [ ] Page views
  - [ ] Custom events (button clicks, form submits)
  - [ ] Conversion goals (e.g., "Apply" button)
  - [ ] User properties (segment, authenticated)

**18.12 Custom event tracking**
- [ ] Status: NOT STARTED
- [ ] Events to track:
  - [ ] IPO viewed: `event('view_ipo', { slug, segment })`
  - [ ] Apply clicked: `event('apply_click', { slug, broker })`
  - [ ] Compare added: `event('compare_add', { slug })`
  - [ ] Watchlist added: `event('watchlist_add', { slug })`
  - [ ] Search performed: `event('search', { query, results })`
  - [ ] Filter applied: `event('filter', { type, value })`
- [ ] Implement using analytics library
- [ ] Test events fire correctly

**18.13 Conversion funnels**
- [ ] Status: NOT STARTED
- [ ] Define funnels:
  - [ ] Homepage → IPO Detail → Apply (Conversion)
  - [ ] Search → Results → IPO Detail → Apply
  - [ ] Calendar → IPO Detail → Watchlist → Apply
- [ ] Set up in analytics platform
- [ ] Monitor drop-off rates
- [ ] Optimize bottleneck steps

#### Week 19: QA, Bug Bash & Launch

**19.1 Run full regression test suite**
- [ ] Status: NOT STARTED
- [ ] Unit tests: `npm run test:unit`
- [ ] Integration tests: `npm run test:integration`
- [ ] E2E tests: `npm run test:e2e`
- [ ] Target: 100% passing
- [ ] Fix any failures before launch

**19.2 Cross-browser testing**
- [ ] Status: NOT STARTED
- [ ] Desktop browsers:
  - [ ] Chrome (latest)
  - [ ] Safari (latest)
  - [ ] Firefox (latest)
  - [ ] Edge (latest)
- [ ] Mobile browsers:
  - [ ] iOS Safari
  - [ ] Android Chrome
  - [ ] Samsung Internet
- [ ] Test all critical flows
- [ ] Fix browser-specific issues

**19.3 Cross-device testing**
- [ ] Status: NOT STARTED
- [ ] Devices:
  - [ ] Desktop: 1920x1080, 1366x768
  - [ ] Tablet: iPad (1024x768), Android tablet
  - [ ] Mobile: iPhone 14 (390x844), Pixel 7 (412x915)
  - [ ] Small mobile: iPhone SE (375x667)
- [ ] Test responsive breakpoints
- [ ] Test touch interactions on mobile/tablet
- [ ] Fix layout issues

**19.4 Accessibility audit**
- [ ] Status: NOT STARTED
- [ ] Automated tools:
  - [ ] Lighthouse Accessibility score ≥95
  - [ ] axe DevTools Chrome extension
  - [ ] WAVE browser extension
- [ ] Manual checks:
  - [ ] Keyboard navigation: Tab through all elements
  - [ ] Screen reader: Test with VoiceOver (Mac) or NVDA (Windows)
  - [ ] Color contrast: ≥4.5:1 for text, ≥3:1 for UI
  - [ ] Focus indicators: Visible on all interactive elements
  - [ ] ARIA labels: Present and accurate
  - [ ] Headings: Proper hierarchy (H1 → H2 → H3)
- [ ] Fix all WCAG 2.1 AA violations

**19.5 Security audit**
- [ ] Status: NOT STARTED
- [ ] OWASP Top 10 checks:
  - [ ] Injection: SQL, XSS, command injection
  - [ ] Broken auth: Session management, password policy
  - [ ] Sensitive data exposure: HTTPS, secure cookies
  - [ ] XML external entities: (N/A for this project)
  - [ ] Broken access control: Check admin routes protected
  - [ ] Security misconfig: Default configs changed
  - [ ] XSS: Input sanitization, CSP headers
  - [ ] Insecure deserialization: (N/A for this project)
  - [ ] Using components with known vulnerabilities: Run `npm audit`
  - [ ] Insufficient logging: Error tracking in place
- [ ] Run `npm audit` and fix vulnerabilities
- [ ] Add security headers: CSP, X-Frame-Options, etc.

**19.6 Load testing**
- [ ] Status: NOT STARTED
- [ ] Use k6 (already have scripts from Phase 5)
- [ ] Test scenarios:
  - [ ] 100 concurrent users: All pages load <2s
  - [ ] 500 concurrent users: P95 <3s
  - [ ] 1000 concurrent users: System stable
- [ ] Monitor:
  - [ ] Response times
  - [ ] Error rates
  - [ ] Database connections
  - [ ] Memory usage
- [ ] Verify no degradation from baseline

**19.7 Fix all P0/P1 bugs**
- [ ] Status: NOT STARTED
- [ ] Create bug tracker (GitHub Issues, Jira, Linear)
- [ ] Triage all bugs: P0 (critical), P1 (high), P2 (medium), P3 (low)
- [ ] Fix all P0 bugs before launch
- [ ] Fix all P1 bugs before launch
- [ ] Document P2/P3 for post-launch

**19.8 Create launch announcement**
- [ ] Status: NOT STARTED
- [ ] Blog post: "Introducing the New IPODhan"
  - [ ] Highlight new features
  - [ ] Visual comparisons (before/after)
  - [ ] User testimonials (if available)
  - [ ] Call to action: Try it now
- [ ] Post on company blog or Medium

**19.9 Prepare social media content**
- [ ] Status: NOT STARTED
- [ ] Platforms: Twitter, LinkedIn, Facebook, Instagram
- [ ] Content:
  - [ ] Teaser posts (1 week before)
  - [ ] Launch announcement (launch day)
  - [ ] Feature highlights (1 per day for 1 week)
  - [ ] User stories (ongoing)
- [ ] Visual assets: Screenshots, videos, GIFs
- [ ] Schedule posts using Buffer or Hootsuite

**19.10 Update screenshots and marketing materials**
- [ ] Status: NOT STARTED
- [ ] Update website: Homepage, about page, features
- [ ] Update app store listings (if PWA)
- [ ] Update press kit: Logo, screenshots, fact sheet
- [ ] Create product demo video (2-3 minutes)

**19.11 Record product demo video**
- [ ] Status: NOT STARTED
- [ ] Script: Intro → Features → CTA
- [ ] Screen recording: Loom, OBS, or Camtasia
- [ ] Voiceover: Clear, enthusiastic
- [ ] Background music: Royalty-free (YouTube Audio Library)
- [ ] Length: 2-3 minutes
- [ ] Upload to YouTube, embed on website

**19.12 Prepare press kit (OPTIONAL)**
- [ ] Status: NOT STARTED
- [ ] Contents:
  - [ ] Company overview
  - [ ] Product description
  - [ ] Key features
  - [ ] Screenshots (high-res)
  - [ ] Logo (various formats: PNG, SVG, EPS)
  - [ ] Founder bio and photo
  - [ ] Press release
  - [ ] Contact information
- [ ] Host on website: `/press-kit` or Notion page

**19.13 Plan launch timeline**
- [ ] Status: NOT STARTED
- [ ] T-7 days: Teaser posts, final QA
- [ ] T-3 days: Blog post draft, press outreach
- [ ] T-1 day: Staging deployment, smoke tests
- [ ] Launch day:
  - [ ] 9 AM: Deploy to production
  - [ ] 10 AM: Publish blog post
  - [ ] 11 AM: Social media announcements
  - [ ] 12 PM: Email newsletter to subscribers
  - [ ] Ongoing: Monitor metrics, respond to feedback
- [ ] T+1 day: Collect feedback, quick fixes
- [ ] T+7 days: Post-launch review meeting

**19.14 Deploy to production**
- [ ] Status: NOT STARTED
- [ ] Pre-deployment checklist:
  - [ ] All tests passing
  - [ ] Database migrations run
  - [ ] Environment variables set
  - [ ] DNS configured
  - [ ] SSL certificates valid
  - [ ] Monitoring enabled (Sentry, logs)
  - [ ] Backup recent database
- [ ] Deploy: `git push origin main` (or deployment platform)
- [ ] Smoke tests: Verify critical pages load
- [ ] Monitor: Watch logs and metrics for 1 hour

**19.15 Monitor for 48 hours**
- [ ] Status: NOT STARTED
- [ ] Metrics to watch:
  - [ ] Error rates (should be <1%)
  - [ ] Response times (P95 <2s)
  - [ ] Page views and traffic
  - [ ] Conversion rates
  - [ ] User feedback (support tickets, social media)
- [ ] On-call: Be available for urgent issues
- [ ] Hotfixes: Deploy immediately for P0 bugs

**19.16 Collect user feedback**
- [ ] Status: NOT STARTED
- [ ] Channels:
  - [ ] In-app feedback widget
  - [ ] Email survey (NPS, CSAT)
  - [ ] Social media mentions
  - [ ] Support tickets
  - [ ] User interviews (optional)
- [ ] Analyze feedback: Trends, pain points, feature requests
- [ ] Create roadmap for next sprint

**19.17 Update SESSION_STATUS.md: Phase 3 COMPLETE**
- [ ] Status: NOT STARTED
- [ ] Mark all Phase 3 tasks complete
- [ ] Update IMPLEMENTATION_STATUS_REPORT.md
- [ ] Document lessons learned
- [ ] Celebrate success! 🎉

---

## Success Criteria Checklist

### Must Have (P0)
- [ ] User experience score: ≥9.0/10 (via survey or UserTesting.com)
- [ ] Page load time: <2s (Lighthouse Performance ≥90)
- [ ] Mobile experience: Fully optimized (Mobile score ≥90)
- [ ] Accessibility: WCAG 2.1 AA compliant (Lighthouse ≥95)
- [ ] Security: No P0/P1 vulnerabilities

### Should Have (P1)
- [ ] User retention: 3x improvement (baseline vs post-launch)
- [ ] Conversion rate: 2x improvement (baseline vs post-launch)
- [ ] Real-time features: Working for OPEN IPOs
- [ ] Data visualization: Charts on all relevant pages
- [ ] Personalization: Watchlist and alerts functional

### Nice to Have (P2)
- [ ] Dark mode: Fully implemented
- [ ] PWA: Installable on mobile
- [ ] Custom dashboards: Drag-and-drop builder
- [ ] A/B testing: Active experiments running
- [ ] Analytics: Conversion funnels tracked

---

## Metrics to Track

### During Implementation
- [ ] Lighthouse Performance score (weekly)
- [ ] Bundle size (KB, weekly)
- [ ] Test coverage percentage (weekly)
- [ ] Open bug count (daily)
- [ ] Features completed vs planned (weekly)

### Post-Launch
- [ ] User retention: 1-day, 7-day, 30-day
- [ ] Conversion rate: Visitors → IPO detail → Apply
- [ ] Bounce rate: Homepage, IPO detail
- [ ] Average session duration
- [ ] Pages per session
- [ ] User satisfaction: NPS score, CSAT score

---

**Phase 3 Status**: NOT STARTED (awaiting Phase 1 & 2 completion)
**Next Action**: Complete Phase 1 and deploy Phase 2 first
**Estimated Completion**: 12 weeks from start date
**Blockers**: Phase 1 & 2 must be done before starting
