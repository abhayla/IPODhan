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
export { DocumentFetchStateRepository } from './document-fetch-state-repository';
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
export { resolveIpoRow } from './ipo-identity';
export type { IpoIdentity } from './ipo-identity';

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
