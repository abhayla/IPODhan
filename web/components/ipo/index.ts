/**
 * IPO Detail Page Components
 *
 * All reusable components for displaying IPO detail information.
 * Created as part of Story 4.2: Detail Page Components
 * Enhanced in Story 4.3: IPO Detail Page Assembly
 */

// Main Components
export { IPOHeader } from './IPOHeader';
export { KeyMetricsCards } from './KeyMetricsCards';
export { KeyMetricsCardsEnhanced } from './KeyMetricsCardsEnhanced';
export { InfoSection } from './InfoSection';
export { IPOTimelineWidget } from './IPOTimelineWidget';
export { StickyDashboardLayout } from './StickyDashboardLayout';
export { SubscriptionBreakdown } from './SubscriptionBreakdown';
export { GMPChart } from './GMPChart';
export { FinancialTable } from './FinancialTable';
export { PeerComparisonTable } from './PeerComparisonTable';
export { DocumentList } from './DocumentList';
export { CompanyOverview } from './CompanyOverview';
export { RatingDisplay } from './RatingDisplay';
export { ShareButtons } from './ShareButtons';
export { AllotmentCheckerCard } from './AllotmentCheckerCard';

// Issue Structure Components (Story 4.11)
export { IssueStructureSection } from './IssueStructureSection';
export { IssueTypeBadge } from './IssueTypeBadge';
export { IssueBreakdownChart } from './IssueBreakdownChart';
export { MinimumInvestmentDisplay } from './MinimumInvestmentDisplay';

// Promoter and Anchor Components
export { PromoterHoldingSection } from './PromoterHoldingSection';
export { AnchorInvestorsSection } from './AnchorInvestorsSection';

// Detail Page Components (Story 4.3)
export { IPODetailTabs } from './IPODetailTabs';

// Existing Components
export { IPOCard } from './IPOCard';
export { IPOCardSkeleton } from './IPOCardSkeleton';
export { IPOGrid } from './IPOGrid';

// Loading Skeletons
export {
  IPOHeaderSkeleton,
  KeyMetricsCardsSkeleton,
  InfoSectionSkeleton,
  SubscriptionBreakdownSkeleton,
  GMPChartSkeleton,
  FinancialTableSkeleton,
  PeerComparisonTableSkeleton,
  DocumentListSkeleton,
  CompanyOverviewSkeleton,
} from './skeletons';
