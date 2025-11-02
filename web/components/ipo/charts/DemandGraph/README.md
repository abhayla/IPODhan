# IPO Demand Graph Component

Visualizes price-wise demand distribution showing cumulative bid demand across price buckets.

## Overview

The DemandGraph component displays an IPO's bidding demand intensity across different price points. It shows cumulative quantities bid at each price level, helping investors understand demand concentration and price preference patterns.

## Features

- **Price Bucket Visualization**: Horizontal bar chart (desktop) / Vertical (mobile)
- **Exchange Filtering**: Filter demand by NSE, BSE, or combined
- **Top N Buckets**: Limit display to most significant price points
- **Summary Statistics**: Total buckets, max demand, cut-off demand, most demanded price
- **Cut-Off Highlighting**: Special formatting for cut-off price demand
- **Demand Intensity**: Color-coded bars based on relative demand strength
- **Responsive**: Adapts layout for mobile (<768px)
- **Progressive Disclosure**: Expand/collapse functionality

## Data Source

- **Table**: `ipo_demand_graph`
- **Fields Used**:
  - `pricePoint`: Price bucket (e.g., ₹695, ₹696)
  - `isCutOff`: Boolean flag for cut-off price
  - `cumulativeQuantity`: Total shares bid at price & above
  - `exchange`: NSE | BSE | BOTH

## Usage

### Basic Usage

```tsx
import { DemandGraph } from '@/components/ipo/charts';

<DemandGraph
  demandRecords={ipoDemandGraphRecords}
  companyName="Swiggy Ltd"
  priceRangeMax={390}
/>
```

### With Options

```tsx
<DemandGraph
  demandRecords={ipoDemandGraphRecords}
  companyName="Swiggy Ltd"
  priceRangeMax={390}
  defaultExchange="NSE"
  defaultExpanded={true}
  showAdvanced={true}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `demandRecords` | `IPODemandRecord[]` | **required** | Demand records from database |
| `companyName` | `string` | **required** | Company name for chart title |
| `priceRangeMax` | `number \| null` | **required** | Maximum price in IPO range |
| `defaultExchange` | `'NSE' \| 'BSE' \| 'BOTH'` | `'BOTH'` | Default exchange filter |
| `defaultExpanded` | `boolean` | `false` | Whether to expand chart initially |
| `showAdvanced` | `boolean` | `true` | Show exchange & top N filters |

## Component Structure

```
DemandGraph/
├── index.tsx       # Main component with chart rendering
├── types.ts        # TypeScript interfaces
├── utils.ts        # Data transformation utilities
└── README.md       # This file
```

## Data Transformation

### Input (Database)
```typescript
{
  id: "uuid",
  ipoId: "uuid",
  pricePoint: 695.00,
  isCutOff: false,
  cumulativeQuantity: 123456789,
  exchange: "NSE",
  timestamp: Date,
}
```

### Output (Chart)
```typescript
{
  priceLabel: "₹695",
  pricePoint: 695.00,
  cumulativeQuantity: 123456789,
  demandIntensity: 85.5, // Normalized 0-100
  isCutOff: false,
  exchange: "NSE",
}
```

## Summary Statistics

The component calculates and displays:

1. **Total Buckets**: Number of distinct price points
2. **Max Demand**: Highest cumulative quantity across all buckets
3. **Cut-Off Demand**: Cumulative quantity at cut-off price (if available)
4. **Most Demanded Price**: Price point with maximum bid demand

## Demand Intensity Color Coding

Bars are color-coded based on relative demand strength:

| Intensity | Range | Color | Chart Variable |
|-----------|-------|-------|----------------|
| Very High | 80-100% | Blue | `--chart-1` |
| High | 60-79% | Green | `--chart-2` |
| Medium | 40-59% | Yellow | `--chart-3` |
| Low-Medium | 20-39% | Orange | `--chart-4` |
| Low | 0-19% | Red | `--chart-5` |

## Performance

### Metrics
- **Render Time**: <150ms (target: <200ms)
- **Component Size**: ~8KB gzipped
- **Dependencies**: Recharts (BarChartBase)

### Optimization
- Memoized data transformations
- Lazy chart rendering (expand-to-view)
- Dynamic height based on bucket count
- Top N filter to limit large datasets

## Responsive Behavior

### Desktop (≥768px)
- Horizontal bar chart
- Expanded summary stats (4 columns)
- Advanced filters visible

### Mobile (<768px)
- Vertical bar chart
- Compact summary stats (2 columns)
- Collapsible filters
- Touch-friendly tooltips

## Empty & Error States

### No Data
Shows message: "Demand data not available yet"

### Invalid Data
Shows alert: "Demand data is incomplete or invalid"

### Filtered Empty
Shows message: "No demand data for selected exchange"

## Integration Example

```tsx
// In IPO Detail Page (page.tsx)

import { DemandGraph } from '@/components/ipo/charts';

// ... fetch IPO data with demand records

<DemandGraph
  demandRecords={data.ipoDemandGraph || []}
  companyName={ipo.companyName}
  priceRangeMax={ipo.priceRangeMax}
  defaultExchange="BOTH"
  defaultExpanded={false}
  showAdvanced={true}
/>
```

## Accessibility

- **ARIA Labels**: Chart elements labeled for screen readers
- **Keyboard Navigation**: Full keyboard support for filters
- **Color Contrast**: WCAG 2.1 AA compliant
- **Focus Management**: Visible focus indicators

## Testing

### Unit Tests
- Data transformation accuracy
- Summary statistics calculation
- Color coding logic
- Validation functions

### Integration Tests
- Component renders with valid data
- Filters update chart correctly
- Expand/collapse functionality
- Responsive layout switches

### Visual Regression
- Chart rendering across viewports
- Empty/error states
- Theme compatibility (light/dark)

## Known Limitations

1. **Data Requirement**: Requires `ipo_demand_graph` table populated by scrapers
2. **Large Datasets**: Use Top N filter for >50 buckets (performance optimization)
3. **Real-time Updates**: Not implemented (static data load)

## Future Enhancements

- [ ] Historical demand comparison (multiple timestamps)
- [ ] Animated bar transitions
- [ ] Download chart as PNG/CSV
- [ ] Demand heatmap view
- [ ] Price range overlay on chart

## Related Components

- `BarChartBase`: Base chart component used for rendering
- `SubscriptionDashboard`: Related subscription tracking component
- `GMPHistoryChart`: GMP trend visualization

## References

- **Design**: Phase 3 - Main Visualizations
- **Story**: IPO Details Page Enhancement
- **Schema**: `packages/shared/src/db/schema.ts` (line 296-327)
- **Phase Report**: `docs/19-ui/ipo-detail-page/PHASE_3_REPORT.md`
