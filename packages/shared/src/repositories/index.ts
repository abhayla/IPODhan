/**
 * Repository Layer Exports
 *
 * Centralized export point for all repository classes and types.
 */

// Repository Classes
export { IPORepository } from './ipo-repository';
export { SubscriptionRepository } from './subscription-repository';
export { GMPRepository } from './gmp-repository';
export { FinancialDataRepository } from './financial-data-repository';
export { DocumentRepository } from './document-repository';
export { ListingPerformanceRepository } from './listing-performance-repository';
export { RegistrarRepository } from './registrar-repository';
export { MarketHolidayRepository } from './market-holiday-repository';
export { ScraperLogRepository } from './scraper-log-repository';
export { FieldSourcesRepository } from './field-sources-repository';
export { DataConflictsRepository } from './data-conflicts-repository';
// Item 4 (OD-21): per-field validation failures recorded before the write.
export { FieldExtractionFailuresRepository } from './field-extraction-failures-repository';
export type {
  RecordFailureInput,
  FieldExtractionFailureRecord,
} from './field-extraction-failures-repository';
export { DocumentFetchStateRepository } from './document-fetch-state-repository';
// Item 6: the field-plan walk (scraper PASS 3) is the first consumer, and it
// reaches the class through this barrel -- the package's `exports` map has no
// `./repositories/ipo-field-plan-repository` subpath, so a deep import
// resolves in tsc and then fails at RUNTIME under vitest's resolver.
export {
  IpoFieldPlanRepository,
  FIELD_PLAN_CLAIM_STALE_MINUTES,
  FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
  FIELD_PLAN_TERMINAL_STATES,
  fieldPlanBackoffMinutes,
} from './ipo-field-plan-repository';
export type {
  IpoFieldPlanRow,
  FieldPlanState,
  ChosenEvidence,
  RecordOutcomeParams,
  RecordOutcomeResult,
  ClaimNextDueFieldParams,
  GeneratedFieldPlanRow,
  UpsertGeneratedRowsResult,
  PlanRowBelowVersion,
  PlanRowRankUpdate,
} from './ipo-field-plan-repository';
export type {
  IDocumentFetchStateStore,
  DocumentFetchStateRow,
  DocumentFetchStatePatch,
  DocumentFetchStateValue,
  FetchAttempt,
} from './document-fetch-state-repository';

// T-428 WP C-1: filing-field repositories
export { FinancialStatementsRepository } from './financial-statements-repository';
export type {
  FinancialStatementRow,
  FinancialStatementUpsert,
  FinancialStatementBasis,
  FinancialUnit,
} from './financial-statements-repository';

export { IpoValuationRepository } from './ipo-valuation-repository';
export type { IpoValuationRow, IpoValuationUpsert, PricingEvent } from './ipo-valuation-repository';

export { PromotersRepository } from './promoters-repository';
export type {
  PromoterRow,
  PromoterInsert,
  PromoterAcquisitionRangeRow,
  PromoterAcquisitionRangeInsert,
  AcquisitionPeriod,
} from './promoters-repository';

export { IpoIntermediariesRepository } from './ipo-intermediaries-repository';
export type {
  IpoIntermediaryRow,
  IpoIntermediaryInsert,
  IntermediaryRole,
} from './ipo-intermediaries-repository';

export { BrlmTrackRecordRepository } from './brlm-track-record-repository';
export type { BrlmTrackRecordRow, BrlmTrackRecordInsert } from './brlm-track-record-repository';

export { IpoRiskFactorsRepository } from './ipo-risk-factors-repository';
export type { IpoRiskFactorRow, IpoRiskFactorInsert } from './ipo-risk-factors-repository';

// Base Repository
export { BaseRepository } from './base-repository';

// IPO identity resolution (T-307 — SSOT for the guard/write three-tier lookup)
export { resolveIpoRow, IdentityHeldForReviewError } from './ipo-identity';
export type { IpoIdentity } from './ipo-identity';
export * from './ipo-source-keys';
export * from './source-key-lineage';

// Types and Interfaces
export type * from './types';

// S-01: per-IPO pipeline step ledger
export { IpoPipelineStepsRepository } from './ipo-pipeline-steps-repository';
export type {
  IpoStepStatus,
  UpsertStepInput,
  PipelineStepRow,
  PipelineGrid,
  PipelineGridIpo,
} from './ipo-pipeline-steps-repository';

// Item 3 slice S4: field-manifest override layer (layer 2 of the policy resolver)
export { FieldSourceOverridesRepository, isMissingTableError } from './field-source-overrides-repository';
export type { FieldSourceOverridesRepositoryDeps } from './field-source-overrides-repository';
