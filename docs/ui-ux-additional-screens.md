# IPODhan Additional Screens - UI/UX Design Specifications

## 1. Broker Comparison & Hub

### 1.1 Broker Listing Page
```
┌─────────────────────────────────────────────────────────────────┐
│  Broker Hub - Compare & Open Demat Accounts                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Featured Offers                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  🎉 Zerodha: Free account opening + ₹500 trading credit  │  │
│  │  🎁 Upstox: Zero AMC for 1st year + Free demat           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Quick Filters                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [All] [Zero Brokerage] [Full Service] [Discount] [3-in-1]│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Compare Brokers (Select up to 3)                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ┌─────────────────┐  ┌─────────────────┐               │  │
│  │  │ ☐ Zerodha       │  │ ☐ Upstox        │               │  │
│  │  │ [Logo]          │  │ [Logo]          │               │  │
│  │  │ ⭐ 4.5 (12.5k) │  │ ⭐ 4.2 (8.3k)   │               │  │
│  │  │                 │  │                 │               │  │
│  │  │ Account: FREE   │  │ Account: FREE   │               │  │
│  │  │ AMC: ₹300/yr   │  │ AMC: FREE 1yr   │               │  │
│  │  │ Equity: ₹20    │  │ Equity: ₹20     │               │  │
│  │  │ IPO: FREE      │  │ IPO: FREE       │               │  │
│  │  │                 │  │                 │               │  │
│  │  │ ✓ Best for     │  │ ✓ Mobile first  │               │  │
│  │  │   traders      │  │ ✓ Good UI       │               │  │
│  │  │ ✓ Kite platform│  │ ✓ Low cost      │               │  │
│  │  │                 │  │                 │               │  │
│  │  │ [Open Account] │  │ [Open Account]  │               │  │
│  │  └─────────────────┘  └─────────────────┘               │  │
│  │                                                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐               │  │
│  │  │ ☐ Angel One     │  │ ☐ Groww         │               │  │
│  │  │ [Logo]          │  │ [Logo]          │               │  │
│  │  │ ⭐ 4.0 (15.2k) │  │ ⭐ 4.3 (6.5k)   │               │  │
│  │  │                 │  │                 │               │  │
│  │  │ Account: FREE   │  │ Account: FREE   │               │  │
│  │  │ AMC: FREE      │  │ AMC: FREE       │               │  │
│  │  │ Equity: ₹20    │  │ Equity: FREE    │               │  │
│  │  │ IPO: FREE      │  │ IPO: FREE       │               │  │
│  │  │                 │  │                 │               │  │
│  │  │ ✓ Zero AMC     │  │ ✓ Beginner      │               │  │
│  │  │ ✓ Smart API    │  │   friendly      │               │  │
│  │  │ ✓ Research     │  │ ✓ Clean UI      │               │  │
│  │  │                 │  │ ✓ Mutual funds  │               │  │
│  │  │ [Open Account] │  │ [Open Account]  │               │  │
│  │  └─────────────────┘  └─────────────────┘               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [Compare Selected (0/3)]                                       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Broker Comparison Table
```
┌─────────────────────────────────────────────────────────────────┐
│  Broker Comparison                              [Edit] [Share]  │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  ┌────────────────┬──────────┬──────────┬──────────┐          │
│  │                │ Zerodha  │ Upstox   │ Angel One│          │
│  ├────────────────┼──────────┼──────────┼──────────┤          │
│  │ Overall Rating │ ⭐ 4.5   │ ⭐ 4.2   │ ⭐ 4.0   │          │
│  │ Users         │ 1.2 Cr   │ 80 Lakh  │ 1.5 Cr   │          │
│  ├────────────────┼──────────┼──────────┼──────────┤          │
│  │ CHARGES        │          │          │          │          │
│  │ Account Open   │ FREE     │ FREE     │ FREE     │          │
│  │ AMC           │ ₹300/yr  │ FREE 1yr │ FREE     │          │
│  │ Equity Deliv. │ FREE     │ ₹20      │ ₹20      │          │
│  │ Equity Intra  │ ₹20      │ ₹20      │ ₹20      │          │
│  │ F&O          │ ₹20      │ ₹20      │ ₹20      │          │
│  │ IPO Apply    │ FREE     │ FREE     │ FREE     │          │
│  ├────────────────┼──────────┼──────────┼──────────┤          │
│  │ FEATURES      │          │          │          │          │
│  │ Mobile App    │ ✅ Kite  │ ✅ Pro   │ ✅ Angel │          │
│  │ Web Platform  │ ✅       │ ✅       │ ✅       │          │
│  │ API Trading   │ ✅       │ ✅       │ ✅       │          │
│  │ IPO Apply     │ ✅       │ ✅       │ ✅       │          │
│  │ Mutual Funds  │ ✅ Coin  │ ✅       │ ✅       │          │
│  │ Research      │ ⭐⭐⭐   │ ⭐⭐     │ ⭐⭐⭐⭐ │          │
│  │ Margin Trade  │ ✅       │ ✅       │ ✅       │          │
│  │ 3-in-1 Account│ ❌       │ ❌       │ ✅ ICICI │          │
│  ├────────────────┼──────────┼──────────┼──────────┤          │
│  │ PROS          │ • Stable │ • Free   │ • Zero   │          │
│  │               │ • Fast   │   AMC    │   AMC    │          │
│  │               │ • Reliable│ • Good UI│ • Research│          │
│  ├────────────────┼──────────┼──────────┼──────────┤          │
│  │ CONS          │ • AMC    │ • New    │ • Avg UI │          │
│  │               │   charges│ • Support│ • Glitchy│          │
│  └────────────────┴──────────┴──────────┴──────────┘          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 💡 Recommendation Based on Your Profile:                  │  │
│  │                                                           │  │
│  │ For IPO Investments: All three are equally good with     │  │
│  │ free IPO applications. Choose based on overall platform. │  │
│  │                                                           │  │
│  │ Best Overall: Zerodha (if okay with ₹300 AMC)           │  │
│  │ Best Free: Angel One (completely free)                   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. IPO Tools Suite

### 2.1 Allotment Checker
```
┌─────────────────────────────────────────────────────────────────┐
│  IPO Allotment Status Checker                                   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Step 1: Select IPO                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Search or Select IPO                                     │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ 🔍 Type IPO name...                                 │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  Recent IPOs:                                             │  │
│  │  ○ TechVista Solutions (Allotment: Jan 20)              │  │
│  │  ○ HealthCore Pharma (Allotment: Jan 19)                │  │
│  │  ○ GreenEnergy Solar (Allotment: Jan 18)                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Step 2: Enter Your Details                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Choose verification method:                              │  │
│  │                                                           │  │
│  │  [PAN] [Application No] [DP ID]                          │  │
│  │                                                           │  │
│  │  PAN Number *                                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ ABCDE1234F                                         │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ☐ Save my details for quick check                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [Check Allotment Status]                                       │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  Result:                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ✅ Congratulations! You've been allotted shares         │  │
│  │                                                           │  │
│  │  Applicant Name:     John Doe                            │  │
│  │  Application No:     1234567890                          │  │
│  │  Category:          Retail                               │  │
│  │  Shares Applied:    150 (3 lots)                        │  │
│  │  Shares Allotted:   50 (1 lot)                          │  │
│  │  Amount Blocked:    ₹45,000                             │  │
│  │  Amount to Refund:  ₹30,000                             │  │
│  │                                                           │  │
│  │  Share Credit Date: Jan 22, 2025                        │  │
│  │  Listing Date:      Jan 23, 2025                        │  │
│  │  Refund Status:     Initiated                           │  │
│  │                                                           │  │
│  │  [Download] [Share Result] [Check Another]              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Returns Calculator
```
┌─────────────────────────────────────────────────────────────────┐
│  IPO Returns Calculator                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Input Parameters                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  IPO Selection                                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │ ▼ TechVista Solutions                              │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  ┌─────────────────────┬──────────────────────────────┐ │  │
│  │  │ Issue Price         │ ₹300 (Auto-filled)           │ │  │
│  │  │ Current GMP         │ +₹45 (Auto-filled)           │ │  │
│  │  │ Lots Applied        │ [3        ] ▲▼              │ │  │
│  │  │ Expected Listing    │ [₹345     ] or use GMP       │ │  │
│  │  └─────────────────────┴──────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Scenario Analysis                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ┌─────────────┬──────────┬──────────┬──────────────┐   │  │
│  │  │ Scenario    │ Pessimistic│ Expected │ Optimistic  │   │  │
│  │  │             │   (-10%)   │  (+15%)  │   (+30%)    │   │  │
│  │  ├─────────────┼──────────┼──────────┼──────────────┤   │  │
│  │  │ List Price  │ ₹270     │ ₹345     │ ₹390         │   │  │
│  │  │ Investment  │ ₹45,000  │ ₹45,000  │ ₹45,000      │   │  │
│  │  │ If Allotted │          │          │              │   │  │
│  │  │ - 1 Lot     │ -₹1,500  │ +₹2,250  │ +₹4,500      │   │  │
│  │  │ - 2 Lots    │ -₹3,000  │ +₹4,500  │ +₹9,000      │   │  │
│  │  │ - 3 Lots    │ -₹4,500  │ +₹6,750  │ +₹13,500     │   │  │
│  │  │ Returns %   │ -10%     │ +15%     │ +30%         │   │  │
│  │  └─────────────┴──────────┴──────────┴──────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Visual Representation                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     Returns Chart                                        │  │
│  │     ₹15k ┤                                   ╱          │  │
│  │     ₹10k ┤                              ╱────           │  │
│  │      ₹5k ┤                      ╱────                  │  │
│  │       ₹0 ┤──────────────────────                      │  │
│  │     -₹5k ┤────╲                                        │  │
│  │           └────┬────┬────┬────┬────┬────               │  │
│  │            -10% -5%  0%  +15% +20% +30%                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Key Insights                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 💡 Break-even point: Listing at ₹300 (issue price)      │  │
│  │ 📈 GMP suggests 15% listing gain (₹45 premium)          │  │
│  │ ⚠️ Maximum loss if not allotted: ₹0 (refund)           │  │
│  │ 🎯 Historical similar IPOs listed at avg +18%           │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 IPO Subscription Predictor
```
┌─────────────────────────────────────────────────────────────────┐
│  Subscription & Allotment Predictor                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Current Status                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  IPO: TechVista Solutions                                │  │
│  │  Day 2 of 3 | Closing in 28 hours                        │  │
│  │                                                           │  │
│  │  Current Subscription: 2.3x                              │  │
│  │  ██████████░░░░░░░░░░░░░░░░░░                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  AI Prediction Model                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📊 Expected Final Subscription                          │  │
│  │                                                           │  │
│  │  Category      Current    Predicted    Confidence       │  │
│  │  ─────────────────────────────────────────────          │  │
│  │  Overall       2.3x       4.8x         85%              │  │
│  │  Retail        3.2x       7.5x         82%              │  │
│  │  QIB           1.8x       3.2x         78%              │  │
│  │  NII           2.1x       4.1x         80%              │  │
│  │                                                           │  │
│  │  Prediction based on:                                    │  │
│  │  • Historical patterns of similar IPOs                   │  │
│  │  • Current market sentiment                              │  │
│  │  • Day-wise subscription velocity                        │  │
│  │  • GMP trends                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Allotment Probability Calculator                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Your Application Details                                │  │
│  │  Category: [Retail ▼]  Lots Applied: [3 ▼]             │  │
│  │                                                           │  │
│  │  📈 Your Allotment Chances                              │  │
│  │  ┌────────────────────────────────────────────────┐     │  │
│  │  │ If subscription ends at predicted 7.5x:        │     │  │
│  │  │                                                 │     │  │
│  │  │ Minimum 1 Lot:  87% ████████▒░               │     │  │
│  │  │ 2 Lots:         32% ███░░░░░░░               │     │  │
│  │  │ Full 3 Lots:    12% █░░░░░░░░░               │     │  │
│  │  │                                                 │     │  │
│  │  │ Expected Allotment: 1 lot                     │     │  │
│  │  │ Lottery Basis: Yes (for 1 lot)               │     │  │
│  │  └────────────────────────────────────────────────┘     │  │
│  │                                                           │  │
│  │  [Set Alert] [Share Prediction] [Download Report]        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. IPO Analysis & Research

### 3.1 IPO Research Report
```
┌─────────────────────────────────────────────────────────────────┐
│  TechVista Solutions - IPO Analysis                   [PDF] [★] │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Quick Navigation                                               │
│  [Overview] [Financials] [SWOT] [Risks] [Valuation] [Verdict]  │
│                                                                  │
│  ┌────────────────────────────┬──────────────────────────────┐ │
│  │  AI-Generated Summary       │  Key Metrics                 │ │
│  │  ───────────────────────    │  ──────────────────────────  │ │
│  │  TechVista is a leading     │  Revenue CAGR:    32%        │ │
│  │  SaaS provider with strong  │  PAT CAGR:        28%        │ │
│  │  growth metrics. The company│  ROCE:            24%        │ │
│  │  has shown consistent       │  Debt/Equity:     0.3        │ │
│  │  profitability and operates │  P/E (at IP):     22x        │ │
│  │  in high-growth markets.    │  Industry P/E:    28x        │ │
│  │                             │                              │ │
│  │  ✅ Strengths:              │  Peer Comparison             │ │
│  │  • Market leader position   │  ┌──────────────────────┐   │ │
│  │  • Strong financials        │  │ Company    P/E  CAGR │   │ │
│  │  • Asset-light model        │  │ TechVista  22x  32%  │   │ │
│  │  • Repeat revenue 65%       │  │ Peer A     28x  25%  │   │ │
│  │                             │  │ Peer B     25x  28%  │   │ │
│  │  ⚠️ Concerns:               │  │ Peer C     30x  22%  │   │ │
│  │  • High competition         │  └──────────────────────┘   │ │
│  │  • Customer concentration   │                              │ │
│  │  • Regulatory risks         │  IPODhan Score: 7.5/10       │ │
│  └────────────────────────────┴──────────────────────────────┘ │
│                                                                  │
│  Financial Snapshot                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │     Revenue Growth              Profit Growth            │  │
│  │     ₹Cr ┤                       ₹Cr ┤                   │  │
│  │     800 ┤            ╱           150 ┤         ╱         │  │
│  │     600 ┤        ╱──             100 ┤     ╱──           │  │
│  │     400 ┤    ╱──                  50 ┤ ╱──               │  │
│  │     200 ┤╱──                       0 └────────────       │  │
│  │       0 └────────────                FY21 FY22 FY23      │  │
│  │         FY21 FY22 FY23                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  SWOT Analysis                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Strengths              │  Weaknesses                    │  │
│  │  • Market Leadership    │  • Customer Concentration     │  │
│  │  • Strong Tech Platform │  • High Marketing Costs       │  │
│  │  • Profitable Growth    │  • Limited Global Presence    │  │
│  │  ─────────────────────────────────────────────────────   │  │
│  │  Opportunities          │  Threats                       │  │
│  │  • Market Expansion     │  • Intense Competition         │  │
│  │  • Product Portfolio    │  • Technology Disruption       │  │
│  │  • International Growth │  • Regulatory Changes          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Investment Decision Helper                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Subscribe if:                Not for you if:            │  │
│  │  ✓ Long-term investor        ✗ Looking for dividends    │  │
│  │  ✓ Bullish on tech sector    ✗ Risk-averse investor     │  │
│  │  ✓ Okay with volatility      ✗ Need immediate returns   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. User Portfolio Dashboard

### 4.1 Portfolio Overview
```
┌─────────────────────────────────────────────────────────────────┐
│  My IPO Portfolio                              Hi, John! 👋    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Portfolio Summary                                              │
│  ┌──────────┬──────────┬──────────┬──────────────────────────┐│
│  │ Applied  │ Allotted │ Success  │ Total Returns            ││
│  │ 25 IPOs  │ 8 IPOs   │ 32%      │ ₹45,230 (+18.5%)        ││
│  └──────────┴──────────┴──────────┴──────────────────────────┘│
│                                                                  │
│  Active Applications                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  IPO Name           Status    Applied   Amount    Action  │  │
│  │  ────────────────────────────────────────────────────── │  │
│  │  TechVista         Pending    3 lots    ₹45,000   [View] │  │
│  │  HealthCore        Applied    2 lots    ₹28,800   [View] │  │
│  │  GreenEnergy       Allotted   1 lot     ₹14,850   [View] │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Performance Analytics                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Monthly Performance                                      │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  +40% ┤                                            │  │  │
│  │  │  +20% ┤    ██    ██         ██                    │  │  │
│  │  │    0% ┤ ██ ██ ██ ██ ██    ██ ██ ██               │  │  │
│  │  │  -20% ┤             ██ ██                        │  │  │
│  │  │       └─────────────────────────────────          │  │  │
│  │  │        J  F  M  A  M  J  J  A  S  O  N  D         │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  Best Performers           Worst Performers             │  │
│  │  1. ABC Tech    +125%      1. XYZ Motors    -18%       │  │
│  │  2. DEF Pharma  +89%       2. PQR Retail    -12%       │  │
│  │  3. GHI Solar   +67%       3. LMN Finance   -8%        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Upcoming Actions                                               │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📅 Jan 20: TechVista allotment results                  │  │
│  │  📅 Jan 22: HealthCore listing day                       │  │
│  │  📅 Jan 23: GreenEnergy shares credit                    │  │
│  │  💡 3 new IPOs match your investment criteria [View]     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 IPO History & Transactions
```
┌─────────────────────────────────────────────────────────────────┐
│  IPO Transaction History                    [Export] [Filter]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Filter: [All] [Allotted] [Not Allotted] [Profit] [Loss]      │
│  Period: [All Time ▼]                                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Date     IPO Name      Applied  Got   Returns  Status    │  │
│  │ ───────────────────────────────────────────────────────  │  │
│  │ Jan 15   TechVista     3 lots   -     -        Pending   │  │
│  │ Jan 10   DataSync      2 lots   1     +₹2,340  Listed   │  │
│  │ Jan 05   FinanceHub    3 lots   0     ₹0       Refunded │  │
│  │ Dec 28   RetailMart    2 lots   1     +₹1,250  Listed   │  │
│  │ Dec 20   AutoTech      4 lots   1     -₹450    Listed   │  │
│  │ Dec 15   EduLearn      1 lot    1     +₹3,200  Listed   │  │
│  │ Dec 10   HealthPlus    3 lots   0     ₹0       Refunded │  │
│  │ Dec 01   CloudServe    2 lots   2     +₹5,670  Listed   │  │
│  │                                                           │  │
│  │ Showing 8 of 25 transactions           [Load More]       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Statistics                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Total Invested:     ₹3,75,000                          │  │
│  │  Amount Allotted:    ₹1,20,000                          │  │
│  │  Current Value:      ₹1,65,230                          │  │
│  │  Realized Gains:     ₹28,450                            │  │
│  │  Unrealized Gains:   ₹16,780                            │  │
│  │  Success Rate:       32% (8/25)                         │  │
│  │  Avg Returns:        +37.5% on allotted                 │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Settings & Profile

### 5.1 User Profile & Preferences
```
┌─────────────────────────────────────────────────────────────────┐
│  Profile & Settings                                    [Logout] │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Profile Information                                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  [Avatar]  John Doe                          [Edit]      │  │
│  │            john.doe@email.com                            │  │
│  │            +91 98765 43210                               │  │
│  │            Member since: Jan 2024                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Investment Profile                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Risk Profile:        [Conservative] [Moderate] [High]   │  │
│  │  Investment Range:    ₹10,000 - ₹2,00,000 per IPO       │  │
│  │  Preferred Category:  [Retail ▼]                         │  │
│  │  Sectors of Interest:                                    │  │
│  │  ☑ Technology  ☑ Healthcare  ☐ Finance  ☑ Energy        │  │
│  │  ☐ Retail     ☑ Manufacturing ☐ Real Estate             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Saved Information (Secure)                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  PAN Numbers:                                            │  │
│  │  • ABCDE1234F (Primary)                    [Remove]      │  │
│  │  • FGHIJ5678K (Spouse)                     [Remove]      │  │
│  │  [+ Add PAN]                                             │  │
│  │                                                           │  │
│  │  Demat Accounts:                                         │  │
│  │  • Zerodha - 1234567890                    [Remove]      │  │
│  │  • Upstox - 0987654321                     [Remove]      │  │
│  │  [+ Add Account]                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Notification Preferences                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  IPO Alerts:                                             │  │
│  │  ☑ New IPO announcements      [Email] [SMS] [Push]      │  │
│  │  ☑ Subscription milestones    [Email] [SMS] [Push]      │  │
│  │  ☑ Allotment results          [Email] [SMS] [Push]      │  │
│  │  ☑ GMP changes > 10%          [Email] [SMS] [Push]      │  │
│  │  ☑ Listing day reminders      [Email] [SMS] [Push]      │  │
│  │                                                           │  │
│  │  Frequency:                                              │  │
│  │  ○ Real-time  ● Daily digest  ○ Weekly summary          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [Save Changes]                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Educational Hub

### 6.1 IPO Learning Center
```
┌─────────────────────────────────────────────────────────────────┐
│  IPO Education Hub                     [Beginner] [Advanced]    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                                                  │
│  Getting Started                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  📚 IPO Basics Course          ⏱ 15 min    [Start]      │  │
│  │  📺 How to Apply for IPOs      ⏱ 8 min     [Watch]      │  │
│  │  📖 Understanding GMP           ⏱ 5 min     [Read]       │  │
│  │  🎯 IPO Investment Strategy     ⏱ 12 min    [Learn]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Interactive Tools                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │ IPO Quiz    │  │ Risk        │  │ Strategy    │      │  │
│  │  │ Test your   │  │ Assessment  │  │ Builder     │      │  │
│  │  │ knowledge   │  │ Calculator  │  │ Tool        │      │  │
│  │  │ [Take Quiz] │  │ [Assess]    │  │ [Build]     │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Frequently Asked Questions                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  ▼ What is the minimum amount to invest in IPO?          │  │
│  │     The minimum investment varies by IPO...               │  │
│  │                                                           │  │
│  │  ▶ How is allotment done in oversubscribed IPOs?        │  │
│  │  ▶ What happens if I don't get allotment?               │  │
│  │  ▶ Can I sell on listing day?                           │  │
│  │  ▶ What is grey market premium?                         │  │
│  │                                              [View All]   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Mobile App Screens

### 7.1 Mobile Tools Menu
```
┌─────────────────────┐
│  📱 IPO Tools       │
│ ─────────────────── │
│                     │
│  ┌───────┬────────┐ │
│  │  📊   │  💰    │ │
│  │ Check │ Returns│ │
│  │ Allot │  Calc  │ │
│  └───────┴────────┘ │
│                     │
│  ┌───────┬────────┐ │
│  │  🎯   │  📈    │ │
│  │ Predict│ Compare│ │
│  │  IPO  │ Brokers│ │
│  └───────┴────────┘ │
│                     │
│  ┌───────┬────────┐ │
│  │  📚   │  💡    │ │
│  │ Learn │  Tips  │ │
│  │ Center│  Daily │ │
│  └───────┴────────┘ │
│                     │
│  Recent Activity    │
│  ─────────────────  │
│  • Checked TechVista│
│    allotment (2h)   │
│  • Calculated returns│
│    for HealthCore   │
│  • Compared 3       │
│    brokers (1d ago) │
└─────────────────────┘
```

### 7.2 Mobile Broker Comparison
```
┌─────────────────────┐
│ Compare Brokers     │
│ ─────────────────── │
│                     │
│ Selected (2/3)      │
│ ┌─────────────────┐ │
│ │ ☑ Zerodha       │ │
│ │   AMC: ₹300/yr  │ │
│ │   ⭐ 4.5        │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ ☑ Upstox        │ │
│ │   AMC: FREE     │ │
│ │   ⭐ 4.2        │ │
│ └─────────────────┘ │
│ ┌─────────────────┐ │
│ │ ☐ Angel One     │ │
│ │   AMC: FREE     │ │
│ │   ⭐ 4.0        │ │
│ └─────────────────┘ │
│                     │
│ [Compare Now]       │
│                     │
│ Quick Comparison    │
│ ─────────────────── │
│         Z    U    A │
│ IPO    FREE FREE FREE│
│ Equity ₹20  ₹20  ₹20│
│ AMC    ₹300 FREE FREE│
└─────────────────────┘
```

### 7.3 Mobile Notifications
```
┌─────────────────────┐
│ 🔔 Notifications    │
│ ─────────────────── │
│                     │
│ Today               │
│ ┌─────────────────┐ │
│ │ 🎉 Allotment    │ │
│ │ You got 1 lot   │ │
│ │ TechVista IPO   │ │
│ │ 2 hours ago     │ │
│ └─────────────────┘ │
│                     │
│ ┌─────────────────┐ │
│ │ 📈 GMP Alert    │ │
│ │ HealthCore GMP  │ │
│ │ increased +15%  │ │
│ │ Now at ₹120    │ │
│ │ 4 hours ago     │ │
│ └─────────────────┘ │
│                     │
│ Yesterday           │
│ ┌─────────────────┐ │
│ │ ⏰ Closing Today│ │
│ │ DataSync IPO    │ │
│ │ closes at 5 PM  │ │
│ │ Applied: 2 lots │ │
│ └─────────────────┘ │
│                     │
│ [Mark all read]     │
└─────────────────────┘
```

---

## Design System Components

### Button States
```
Default:     [Apply Now]           - Blue background
Hover:       [Apply Now]           - Darker blue, shadow
Loading:     [⟳ Processing...]     - Disabled, spinner
Success:     [✓ Applied]           - Green background
Error:       [⚠ Try Again]         - Red background
Disabled:    [Closed]              - Gray background
```

### Status Badges
```
LIVE:        Green badge with pulse animation
UPCOMING:    Blue badge
CLOSED:      Gray badge
LISTED:      Purple badge
```

### Alert Types
```
Success:     Green background with ✓ icon
Warning:     Yellow background with ⚠ icon
Error:       Red background with ✗ icon
Info:        Blue background with ℹ icon
```

### Loading States
```
Skeleton:    Animated gray bars
Spinner:     Rotating circle
Progress:    Linear progress bar
Shimmer:     Gradient animation
```

---

## Accessibility Features

1. **Keyboard Navigation**
   - Tab through all interactive elements
   - Enter/Space to activate buttons
   - Escape to close modals
   - Arrow keys for navigation

2. **Screen Reader Support**
   - Proper ARIA labels
   - Semantic HTML structure
   - Alternative text for images
   - Announced state changes

3. **Visual Accessibility**
   - High contrast mode
   - Adjustable font sizes
   - Color blind friendly palettes
   - Focus indicators

4. **Mobile Accessibility**
   - Large touch targets (44x44px minimum)
   - Swipe gestures
   - Voice commands support
   - Haptic feedback

---

## Implementation Priority

### Phase 1: Core Tools
1. Allotment Checker
2. Returns Calculator
3. Basic Broker Comparison

### Phase 2: Analysis
1. IPO Research Reports
2. Subscription Predictor
3. Portfolio Dashboard

### Phase 3: Advanced
1. Educational Hub
2. Advanced Analytics
3. Social Features

### Phase 4: Optimization
1. AI Recommendations
2. Personalization
3. Gamification

---

*These additional screens complete the comprehensive UI/UX design for IPODhan, covering all major user journeys and features.*