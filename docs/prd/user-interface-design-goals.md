# User Interface Design Goals

### Overall UX Vision
IPODhan's interface philosophy centers on **"Progressive Disclosure"** - starting with a single decision point (Apply/Skip) in WhatsApp, then revealing more depth only when users seek it. The UI should feel like a trusted advisor simplifying complex decisions, not a data dashboard overwhelming with metrics.

### Key Interaction Paradigms
- **Binary First**: Lead with clear YES/NO recommendations before showing supporting data
- **Thumb-Friendly**: All critical actions accessible with one-thumb mobile navigation
- **Glanceable Information**: Key insights visible in 3-second scan (traffic light colors, A-F grades)
- **Push Over Pull**: Proactive notifications via WhatsApp/app rather than requiring user visits
- **Trust Through Transparency**: Admit uncertainty with "Borderline" labels, show crowd wisdom

### Core Screens and Views

**Stage 1 (Web + WhatsApp):**
- Home Dashboard (Today's IPOs with scores)
- IPO Detail Page (Score breakdown, apply buttons)
- My Watchlist (Tracked IPOs)
- WhatsApp Chat Interface
- Morning Digest Template

**Stage 2 (Full Platform):**
- Report Cards (Post-listing grades)
- Broker Comparison Table
- Community Forums
- Mobile App Screens
- Settings/Preferences

### Accessibility
**WCAG AA** compliance with specific focus on:
- High contrast for score displays (green/red colorblind-safe)
- Large touch targets (minimum 44px) for mobile
- Screen reader support for scores and recommendations

### Branding
- **Visual Identity**: Clean, trustworthy, approachable (not corporate/intimidating)
- **Color Palette**:
  - Primary: Trust Blue (#2563EB)
  - Success: Growth Green (#10B981)
  - Warning: Caution Amber (#F59E0B)
  - Background: Clean White/Light Gray
- **Typography**: Clear sans-serif (Inter/Roboto) with strong hierarchy
- **Score Display**: Large, bold numbers with color coding (70+ green, 40-69 yellow, <40 red)

### Target Device and Platforms
**Web Responsive** initially, with progressive enhancement to:
- WhatsApp (primary channel)
- Mobile Web (PWA capable)
- Native Mobile Apps (React Native, Month 9+)
- API/Widget embeds for partner sites

---
