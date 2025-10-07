# IPO Rating Methodology

**Version:** 1.0
**Last Updated:** 2025-10-07
**Status:** Active

## Overview

IPODhan uses a proprietary algorithmic rating system to evaluate IPOs on a scale of 1-5 stars (with 0.5 increments). The rating is calculated based on five key factors that assess the quality and attractiveness of an IPO investment opportunity.

**Rating Scale:**
- 5.0 stars: Excellent
- 4.0-4.5 stars: Very Good
- 3.0-3.5 stars: Good
- 2.0-2.5 stars: Fair
- 1.0-1.5 stars: Below Average

## Rating Factors

The rating algorithm considers five factors, each weighted according to its importance in evaluating IPO quality:

### 1. Subscription Level (30% weight)

**What it measures:** Market demand for the IPO based on subscription multiples.

**Scoring Criteria:**
| Subscription Multiple | Score |
|----------------------|-------|
| < 1x                 | 1 star |
| 1-5x                 | 2 stars |
| 5-10x                | 3 stars |
| 10-20x               | 4 stars |
| > 20x                | 5 stars |

**Rationale:** High subscription indicates strong investor demand and confidence in the IPO. This is the most heavily weighted factor as it represents real market sentiment.

**Data Source:** Latest subscription data from the IPO bidding process.

---

### 2. Promoter Holding (20% weight)

**What it measures:** The percentage of equity retained by promoters post-IPO.

**Scoring Criteria:**
| Promoter Holding | Score |
|-----------------|-------|
| < 40%           | 1 star |
| 40-50%          | 2 stars |
| 50-60%          | 3 stars |
| 60-75%          | 4 stars |
| > 75%           | 5 stars |

**Rationale:** Higher promoter holding indicates strong confidence in the company's future. Promoters "putting their money where their mouth is" is a positive signal.

**Data Source:** Financial data and issue structure (estimated from reserves/net worth ratio in MVP).

**Note:** In the MVP version, promoter holding is estimated based on financial metrics. Future versions will use actual shareholding data from DRHP/RHP documents.

---

### 3. Financial Performance (20% weight)

**What it measures:** Revenue and profit growth comparing FY2024 vs FY2023.

**Scoring Criteria:**
| Average Growth | Score |
|---------------|-------|
| Negative      | 1 star |
| 0-10%         | 2 stars |
| 10-25%        | 3 stars |
| 25-50%        | 4 stars |
| > 50%         | 5 stars |

**Calculation:**
1. Calculate revenue growth: `((Revenue FY2024 - Revenue FY2023) / Revenue FY2023) * 100`
2. Calculate profit growth: `((Profit FY2024 - Profit FY2023) / Profit FY2023) * 100`
3. Take average of both growth rates

**Rationale:** Strong financial growth indicates a healthy, expanding business that can justify its valuation.

**Data Source:** Financial statements from DRHP/RHP (FY2023 and FY2024 data).

---

### 4. Grey Market Premium (GMP) (15% weight)

**What it measures:** Premium or discount in the unofficial grey market relative to issue price.

**Scoring Criteria:**
| GMP (% of Issue Price) | Score |
|-----------------------|-------|
| < 0%                  | 1 star |
| 0-10%                 | 2 stars |
| 10-25%                | 3 stars |
| 25-50%                | 4 stars |
| > 50%                 | 5 stars |

**Calculation:**
1. Take average of last 3 GMP records
2. Calculate GMP percentage: `(Average GMP / Issue Price) * 100`

**Rationale:** GMP reflects market expectations for listing gains. Positive GMP suggests the issue is priced attractively.

**Data Source:** Grey market data from multiple sources, averaged over the last 3 records to smooth volatility.

**Note:** GMP is unofficial and speculative. It's weighted lower than fundamental factors.

---

### 5. Peer P/E Comparison (15% weight)

**What it measures:** How the IPO's P/E ratio compares to listed peer companies.

**Scoring Criteria:**
| IPO P/E vs Peer Avg | Score | Interpretation |
|--------------------|-------|----------------|
| > 150%             | 1 star | Overvalued |
| 120-150%           | 2 stars | Expensive |
| 90-120%            | 3 stars | Fair value |
| 70-90%             | 4 stars | Attractive |
| < 70%              | 5 stars | Undervalued |

**Calculation:**
1. Calculate IPO P/E ratio from financial data
2. Calculate average P/E of peer companies in the same sector
3. Calculate ratio: `(IPO P/E / Average Peer P/E) * 100`

**Rationale:** Peer comparison provides context for valuation. Lower P/E relative to peers suggests the IPO is attractively priced.

**Data Source:** Peer company data including P/E ratios for listed companies in the same sector.

---

## Rating Calculation Process

### Step 1: Calculate Individual Factor Scores

Each factor is evaluated independently and assigned a score from 1-5 stars based on the criteria above. If data is unavailable for a factor, it receives a `null` score.

### Step 2: Apply Weights

Each factor score is multiplied by its weight:
```
Weighted Score = Factor Score × Factor Weight
```

Example:
- Subscription: 5 stars × 0.30 = 1.50
- Promoter: 4 stars × 0.20 = 0.80
- Financials: 3 stars × 0.20 = 0.60
- GMP: 3 stars × 0.15 = 0.45
- Peer P/E: 4 stars × 0.15 = 0.60

### Step 3: Calculate Total Score

Sum all weighted scores and normalize:
```
Total Score = Sum of Weighted Scores / Sum of Available Weights
```

Example (all 5 factors available):
```
Total Score = (1.50 + 0.80 + 0.60 + 0.45 + 0.60) / 1.00 = 3.95
```

### Step 4: Round to Nearest 0.5

The final rating is rounded to the nearest 0.5 increment:
```
Final Rating = round(Total Score × 2) / 2
```

Example: 3.95 rounds to 4.0 stars

### Step 5: Clamp Between 1.0 and 5.0

Ensure the rating stays within bounds:
```
Final Rating = max(1.0, min(5.0, Final Rating))
```

---

## Data Requirements

**Minimum Data Threshold:** At least **3 out of 5 factors** must be available to calculate a rating.

If fewer than 3 factors are available, the IPO will show "Rating unavailable" with a message explaining insufficient data.

**Why this threshold?**
- Ensures the rating is based on substantial information
- Prevents misleading ratings from limited data
- Maintains credibility of the rating system

---

## Example Calculation

### Scenario: Strong IPO with All Data Available

**IPO Details:**
- Subscription: 25x (5 stars)
- Promoter Holding: 65% (4 stars)
- Financials: 20% revenue growth, 30% profit growth = 25% avg (3 stars)
- GMP: ₹22 on ₹120 issue price = 18.3% (3 stars)
- Peer P/E: IPO at 25 vs peer avg 30 = 83% (4 stars)

**Calculation:**
```
Subscription:    5 × 0.30 = 1.50
Promoter:        4 × 0.20 = 0.80
Financials:      3 × 0.20 = 0.60
GMP:             3 × 0.15 = 0.45
Peer P/E:        4 × 0.15 = 0.60
                          -----
Total:                    3.95
Rounded:                  4.0 stars
```

**Rationale Generated:**
> "Strong rating (4.0/5) driven by excellent subscription (25.0x), positive GMP (₹22, +18%), and Strong financials with 20% revenue growth. High promoter confidence, attractive valuation vs peers."

---

### Scenario: Weak IPO with Mixed Data

**IPO Details:**
- Subscription: 0.8x (1 star)
- Promoter Holding: 45% (2 stars)
- Financials: -10% revenue growth, -20% profit growth = -15% avg (1 star)
- GMP: ₹-15 on ₹100 issue price = -15% (1 star)
- Peer P/E: IPO at 45 vs peer avg 25 = 180% (1 star)

**Calculation:**
```
Subscription:    1 × 0.30 = 0.30
Promoter:        2 × 0.20 = 0.40
Financials:      1 × 0.20 = 0.20
GMP:             1 × 0.15 = 0.15
Peer P/E:        1 × 0.15 = 0.15
                          -----
Total:                    1.20
Rounded:                  1.0 stars
```

**Rationale Generated:**
> "Below average rating (1.0/5) driven by moderate subscription (0.8x), negative GMP (₹-15, -15%), and Weak financials with -10% revenue growth. Low promoter confidence, expensive valuation vs peers."

---

### Scenario: Partial Data (3 factors only)

**IPO Details:**
- Subscription: 12x (4 stars)
- Promoter Holding: N/A
- Financials: 18% revenue growth, 22% profit growth = 20% avg (3 stars)
- GMP: N/A
- Peer P/E: IPO at 28 vs peer avg 30 = 93% (3 stars)

**Calculation:**
```
Subscription:    4 × 0.30 = 1.20
Financials:      3 × 0.20 = 0.60
Peer P/E:        3 × 0.15 = 0.45
                          -----
Total weights:   0.30 + 0.20 + 0.15 = 0.65
Normalized:      (1.20 + 0.60 + 0.45) / 0.65 = 3.46
Rounded:                                       3.5 stars
```

**Rationale Generated:**
> "Good rating (3.5/5) driven by excellent subscription (12.0x), and Moderate financials with 18% revenue growth. fair valuation vs peers (2 factors unavailable)."

---

## Limitations and Caveats

### 1. Data Quality
- Rating accuracy depends on the quality and timeliness of input data
- Financial data is historical and may not reflect current business conditions
- GMP is unofficial and can be manipulated

### 2. MVP Limitations
- Promoter holding is estimated (not extracted from actual documents)
- Peer comparison may be limited if sector has few listed companies
- Does not consider qualitative factors (management quality, competitive moats, etc.)

### 3. Not Investment Advice
- The rating is an analytical tool, not investment advice
- Investors should conduct their own due diligence
- Past performance and ratings do not guarantee future results

### 4. Market Conditions
- Ratings do not account for overall market sentiment or macroeconomic conditions
- A high-rated IPO can still decline if markets are bearish

---

## Admin Override

In exceptional cases, the platform admin can manually override the algorithmic rating:

- **Override Flag:** `ratingOverride` field in the database
- **When to Use:**
  - Significant events not captured by the algorithm
  - Data quality issues requiring manual intervention
  - Regulatory or compliance concerns
- **Process:** Set `ratingOverride = true` to prevent automatic recalculation

**Note:** Admin override capability is limited in MVP. Full admin UI will be added in Phase 2.

---

## Rating Updates

### Frequency
- Ratings are calculated via batch script, not in real-time
- Script can be run manually: `npm run calculate-ratings --workspace=web`
- In production, script should run:
  - Daily during IPO subscription period
  - After scraper updates (new subscription/GMP data)
  - On-demand for specific IPOs

### Cache Invalidation
- Rating updates automatically invalidate relevant Redis cache keys
- Ensures users see fresh ratings immediately after calculation

---

## Future Enhancements (Phase 2)

### Planned Improvements:
1. **Machine Learning Model**
   - Train on historical IPO performance
   - Incorporate more complex patterns
   - Predict listing gains

2. **Qualitative Factors**
   - Management quality scoring
   - Industry trends analysis
   - Competitive positioning

3. **Real-time Updates**
   - Automatic recalculation on data changes
   - Webhook integration with scraper

4. **Historical Rating Tracking**
   - Track rating changes over time
   - Compare predicted vs actual performance

5. **User Feedback Loop**
   - Collect user ratings and feedback
   - Improve algorithm based on outcomes

6. **Sector-specific Weights**
   - Different factor weights for different sectors
   - Technology vs manufacturing vs finance

---

## Technical Implementation

**Location:** `web/lib/services/rating-service.ts`

**Key Functions:**
- `calculateIPORating()`: Main rating calculation function
- `calculateSubscriptionScore()`: Subscription factor
- `calculatePromoterHoldingScore()`: Promoter holding factor
- `calculateFinancialsScore()`: Financial performance factor
- `calculateGMPScore()`: GMP factor
- `calculatePeerPEScore()`: Peer comparison factor
- `generateRatingRationale()`: Human-readable explanation

**Database Fields:**
- `ipos.rating`: Numeric rating (1-5, 0.5 increments)
- `ipos.ratingRationale`: Text explanation
- `ipos.ratingOverride`: Boolean flag for manual override

**API Integration:**
- Ratings are returned in IPO detail endpoint: `GET /api/ipos/{slug}`
- Displayed on IPO detail page and dashboard cards

---

## Testing

**Unit Tests:** `tests/unit/lib/services/rating-service.test.ts`
- Tests all 5 factors with various inputs
- Edge cases (zero values, missing data, extreme values)
- Rounding behavior
- Rationale generation

**Integration Tests:** `tests/integration/lib/scripts/calculate-ratings.test.ts`
- Database operations
- Cache invalidation
- Batch processing
- Override functionality

**Coverage Target:** >90% for rating service code

---

## References

- [Story 4.4: Rating System Implementation](../stories/4.4.rating-system.story.md)
- [Epic 4: IPO Detail Page](../epics/epic-4-sharded.md)
- [API Specification](../architecture/api-specification.md)
- [Data Models](../architecture/data-models.md)

---

## Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-10-07 | 1.0 | Initial methodology documentation | Claude (Dev Agent) |

---

## Feedback and Questions

For questions about the rating methodology or suggestions for improvements, please contact the product team or open a discussion in the project repository.

**Disclaimer:** This rating system is proprietary to IPODhan and is subject to change. The methodology is provided for transparency but should not be reverse-engineered or copied without permission.
