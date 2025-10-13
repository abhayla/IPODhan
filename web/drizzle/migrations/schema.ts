import { pgTable, index, foreignKey, uuid, varchar, timestamp, integer, text, unique, check, jsonb, boolean, bigint, date, numeric, pgView, doublePrecision, pgMaterializedView, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const documentType = pgEnum("document_type", ['DRHP', 'RHP', 'PROSPECTUS', 'ADDENDUM'])
export const exchange = pgEnum("exchange", ['NSE', 'BSE', 'BOTH'])
export const financialStatementType = pgEnum("financial_statement_type", ['CONSOLIDATED', 'STANDALONE'])
export const holidayType = pgEnum("holiday_type", ['TRADING', 'SETTLEMENT', 'BOTH'])
export const ipoCategory = pgEnum("ipo_category", ['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO'])
export const ipoStatus = pgEnum("ipo_status", ['UPCOMING', 'OPEN', 'CLOSED', 'LISTED'])
export const reviewRecommendation = pgEnum("review_recommendation", ['May apply', 'Subscribe', 'Avoid', 'Not Recommended'])


export const ipoReviews = pgTable("ipo_reviews", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	reviewTitle: varchar("review_title", { length: 500 }).notNull(),
	author: varchar({ length: 255 }).notNull(),
	recommendation: reviewRecommendation().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	publishedDate: timestamp("published_date", { mode: 'string' }).notNull(),
	year: integer().notNull(),
	category: ipoCategory().notNull(),
	reviewUrl: text("review_url"),
	reviewContent: text("review_content"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ipo_reviews_category").using("btree", table.category.asc().nullsLast().op("enum_ops")),
	index("idx_ipo_reviews_category_year_published").using("btree", table.category.asc().nullsLast().op("enum_ops"), table.year.asc().nullsLast().op("timestamp_ops"), table.publishedDate.asc().nullsLast().op("enum_ops")),
	index("idx_ipo_reviews_ipo_id").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	index("idx_ipo_reviews_year").using("btree", table.year.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "ipo_reviews_ipo_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	subscriptionTier: varchar("subscription_tier", { length: 20 }).default('FREE'),
	preferences: jsonb().default({}),
	metadata: jsonb().default({}),
	emailVerified: boolean("email_verified").default(false),
	phoneVerified: boolean("phone_verified").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_users_phone").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	unique("users_email_key").on(table.email),
	unique("users_phone_key").on(table.phone),
	check("users_subscription_tier_check", sql`(subscription_tier)::text = ANY ((ARRAY['FREE'::character varying, 'BASIC'::character varying, 'PREMIUM'::character varying])::text[])`),
]);

export const apiKeys = pgTable("api_keys", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	keyHash: varchar("key_hash", { length: 255 }).notNull(),
	partnerName: varchar("partner_name", { length: 255 }).notNull(),
	tier: varchar({ length: 20 }).notNull(),
	rateLimit: integer("rate_limit").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	expiresAt: timestamp("expires_at", { mode: 'string' }),
	lastUsedAt: timestamp("last_used_at", { mode: 'string' }),
	isActive: boolean("is_active").default(true),
}, (table) => [
	unique("api_keys_key_hash_key").on(table.keyHash),
	check("api_keys_tier_check", sql`(tier)::text = ANY ((ARRAY['BASIC'::character varying, 'STANDARD'::character varying, 'ENTERPRISE'::character varying])::text[])`),
]);

export const pipelineStatus = pgTable("pipeline_status", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	source: varchar({ length: 50 }).notNull(),
	pipelineType: varchar("pipeline_type", { length: 20 }).notNull(),
	status: varchar({ length: 20 }).notNull(),
	lastRunAt: timestamp("last_run_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	lastSuccessAt: timestamp("last_success_at", { mode: 'string' }),
	consecutiveFailures: integer("consecutive_failures").default(0),
	recordsProcessed: integer("records_processed").default(0),
	recordsInserted: integer("records_inserted").default(0),
	recordsUpdated: integer("records_updated").default(0),
	executionTimeMs: integer("execution_time_ms"),
	errorMessage: text("error_message"),
	errorDetails: jsonb("error_details"),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_pipeline_status_last_run").using("btree", table.lastRunAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_pipeline_status_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	unique("pipeline_status_source_pipeline_type_key").on(table.source, table.pipelineType),
	check("pipeline_status_pipeline_type_check", sql`(pipeline_type)::text = ANY ((ARRAY['IPO_DATA'::character varying, 'GMP_DATA'::character varying])::text[])`),
	check("pipeline_status_status_check", sql`(status)::text = ANY ((ARRAY['SUCCESS'::character varying, 'FAILURE'::character varying, 'RUNNING'::character varying])::text[])`),
	check("pipeline_status_source_check", sql`(source)::text = ANY ((ARRAY['NSE'::character varying, 'BSE'::character varying, 'IPOWATCH'::character varying, 'INVESTORGAIN'::character varying, 'CHITTORGARH'::character varying, 'ALL'::character varying])::text[])`),
]);

export const abExperiments = pgTable("ab_experiments", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	variants: jsonb().notNull(),
	startDate: timestamp("start_date", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	endDate: timestamp("end_date", { mode: 'string' }),
	status: varchar({ length: 20 }).default('ACTIVE'),
	results: jsonb().default({}),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_ab_experiments_status").using("btree", table.status.asc().nullsLast().op("text_ops"), table.startDate.desc().nullsFirst().op("text_ops")),
	unique("ab_experiments_name_key").on(table.name),
	check("ab_experiments_status_check", sql`(status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'PAUSED'::character varying, 'COMPLETED'::character varying])::text[])`),
]);

export const documents = pgTable("documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	type: documentType().notNull(),
	title: varchar({ length: 255 }).notNull(),
	url: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fileSize: bigint("file_size", { mode: "number" }),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "documents_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
]);

export const marketHolidays = pgTable("market_holidays", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	date: date().notNull(),
	description: varchar({ length: 255 }).notNull(),
	exchange: exchange().notNull(),
	type: holidayType().notNull(),
	year: integer().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_market_holidays_date").using("btree", table.date.asc().nullsLast().op("date_ops")),
	index("idx_market_holidays_year").using("btree", table.year.asc().nullsLast().op("int4_ops")),
]);

export const registrars = pgTable("registrars", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 255 }).notNull(),
	shortName: varchar("short_name", { length: 100 }),
	email: varchar({ length: 255 }),
	phone: varchar({ length: 20 }),
	website: text(),
	allotmentCheckUrl: text("allotment_check_url"),
	address: text(),
	logoUrl: text("logo_url"),
	active: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const gmpHistory = pgTable("gmp_history", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	gmpValue: numeric("gmp_value", { precision: 10, scale:  2 }).notNull(),
	gmpPercentage: numeric("gmp_percentage", { precision: 5, scale:  2 }).notNull(),
	kostakRate: numeric("kostak_rate", { precision: 10, scale:  2 }),
	source: varchar({ length: 50 }).notNull(),
	recordedAt: timestamp("recorded_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_gmp_history_ipo").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.recordedAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "gmp_history_ipo_id_fkey"
		}).onDelete("cascade"),
]);

export const subscriptionData = pgTable("subscription_data", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	category: varchar({ length: 20 }).notNull(),
	subscriptionTimes: numeric("subscription_times", { precision: 10, scale:  2 }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharesOffered: bigint("shares_offered", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharesBid: bigint("shares_bid", { mode: "number" }).notNull(),
	recordedAt: timestamp("recorded_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_subscription_data_ipo").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.recordedAt.desc().nullsFirst().op("timestamp_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "subscription_data_ipo_id_fkey"
		}).onDelete("cascade"),
	check("subscription_data_category_check", sql`(category)::text = ANY ((ARRAY['QIB'::character varying, 'NII'::character varying, 'RETAIL'::character varying, 'EMPLOYEE'::character varying])::text[])`),
]);

export const userWatchlist = pgTable("user_watchlist", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	ipoId: uuid("ipo_id").notNull(),
	addedAt: timestamp("added_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_user_watchlist_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_watchlist_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "user_watchlist_ipo_id_fkey"
		}).onDelete("cascade"),
	unique("user_watchlist_user_id_ipo_id_key").on(table.userId, table.ipoId),
]);

export const ipoDetails = pgTable("ipo_details", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	isin: varchar({ length: 12 }),
	companyDescription: text("company_description"),
	issueType: varchar("issue_type", { length: 20 }),
	freshIssue: numeric("fresh_issue", { precision: 12, scale:  2 }),
	ofsIssue: numeric("ofs_issue", { precision: 12, scale:  2 }),
	cutOffPrice: numeric("cut_off_price", { precision: 10, scale:  2 }),
	faceValue: numeric("face_value", { precision: 10, scale:  2 }),
	minInvestment: numeric("min_investment", { precision: 12, scale:  2 }),
	basisOfAllotmentDate: date("basis_of_allotment_date"),
	initiationOfRefundsDate: date("initiation_of_refunds_date"),
	creditOfSharesDate: date("credit_of_shares_date"),
	registrarLink: varchar("registrar_link", { length: 500 }),
	leadManagers: text("lead_managers").array(),
	exchanges: text().array().default(["RAY['NSE'::text", "'BSE'::tex"]),
	dataSource: varchar("data_source", { length: 50 }).notNull(),
	lastVerifiedAt: timestamp("last_verified_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_ipo_details_data_source").using("btree", table.dataSource.asc().nullsLast().op("text_ops")),
	index("idx_ipo_details_ipo_id").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	index("idx_ipo_details_isin").using("btree", table.isin.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "ipo_details_ipo_id_fkey"
		}).onDelete("cascade"),
	unique("ipo_details_ipo_id_key").on(table.ipoId),
	unique("ipo_details_isin_key").on(table.isin),
	check("ipo_details_issue_type_check", sql`(issue_type)::text = ANY ((ARRAY['BOOK_BUILDING'::character varying, 'FIXED_PRICE'::character varying, 'HYBRID'::character varying])::text[])`),
]);

export const brokerAffiliates = pgTable("broker_affiliates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	brokerName: varchar("broker_name", { length: 255 }).notNull(),
	brokerLogo: text("broker_logo"),
	affiliateUrl: text("affiliate_url").notNull(),
	displayText: varchar("display_text", { length: 100 }),
	active: boolean().default(true).notNull(),
	displayOrder: integer("display_order").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_broker_affiliates_active_order").using("btree", table.active.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")),
]);

export const scraperLogs = pgTable("scraper_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	source: text().notNull(),
	status: text().notNull(),
	recordsProcessed: integer("records_processed").default(0),
	recordsFailed: integer("records_failed").default(0),
	durationMs: integer("duration_ms").notNull(),
	errorMessage: text("error_message"),
	errorStack: text("error_stack"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_scraper_logs_created_at").using("btree", table.createdAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_scraper_logs_source_created_at").using("btree", table.source.asc().nullsLast().op("timestamp_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("idx_scraper_logs_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const ipos = pgTable("ipos", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	symbol: varchar({ length: 20 }),
	companyName: varchar("company_name", { length: 255 }).notNull(),
	issueSize: numeric("issue_size", { precision: 12, scale:  2 }),
	priceBandLow: numeric("price_band_low", { precision: 10, scale:  2 }).notNull(),
	priceBandHigh: numeric("price_band_high", { precision: 10, scale:  2 }).notNull(),
	lotSize: integer("lot_size").notNull(),
	openDate: date("open_date").notNull(),
	closeDate: date("close_date").notNull(),
	listingDate: date("listing_date"),
	status: varchar({ length: 20 }).notNull(),
	category: varchar({ length: 20 }).notNull(),
	registrar: varchar({ length: 100 }),
	exchange: varchar({ length: 20 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	registrarId: uuid("registrar_id"),
	ratingOverride: boolean("rating_override").default(false),
	slug: varchar("slug", { length: 255 }).notNull(),
	sector: varchar({ length: 100 }),
	priceRangeMin: integer("price_range_min"),
	priceRangeMax: integer("price_range_max"),
	lastScrapedAt: timestamp("last_scraped_at", { mode: 'string' }),
	listingExchanges: jsonb("listing_exchanges"),
	rating: integer(),
	ratingRationale: text("rating_rationale"),
	faceValue: integer("face_value"),
	allotmentDate: date("allotment_date"),
	companyDescription: text("company_description"),
	leadManagers: jsonb("lead_managers"),
	gmp: numeric({ precision: 10, scale:  2 }),
	gmpPercentage: numeric("gmp_percentage", { precision: 5, scale:  2 }),
	gmpUpdatedAt: timestamp("gmp_updated_at", { mode: 'string' }),
}, (table) => [
	index("idx_ipo_details_dates").using("btree", table.openDate.asc().nullsLast().op("date_ops"), table.closeDate.asc().nullsLast().op("date_ops")),
	index("idx_ipo_details_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("idx_ipos_category").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("idx_ipos_company_name_trgm").using("gin", table.companyName.asc().nullsLast().op("gin_trgm_ops")),
	index("idx_ipos_dates").using("btree", table.openDate.asc().nullsLast().op("date_ops"), table.closeDate.asc().nullsLast().op("date_ops")),
	index("idx_ipos_gmp_updated_at").using("btree", table.gmpUpdatedAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_ipos_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.registrarId],
			foreignColumns: [registrars.id],
			name: "ipos_registrar_id_registrars_id_fk"
		}),
	unique("ipos_symbol_key").on(table.symbol),
	unique("ipos_slug_unique").on(table.slug),
	check("ipos_status_check", sql`(status)::text = ANY ((ARRAY['UPCOMING'::character varying, 'OPEN'::character varying, 'LIVE'::character varying, 'CLOSED'::character varying, 'LISTED'::character varying])::text[])`),
	check("ipos_category_check", sql`(category)::text = ANY ((ARRAY['MAINBOARD'::character varying, 'SME'::character varying, 'RIGHTS'::character varying, 'NCD'::character varying])::text[])`),
]);

export const ipoScores = pgTable("ipo_scores", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	totalScore: integer("total_score").notNull(),
	fundamentalScore: integer("fundamental_score").notNull(),
	sentimentScore: integer("sentiment_score").notNull(),
	subscriptionScore: integer("subscription_score").notNull(),
	sectorScore: integer("sector_score").notNull(),
	verdict: varchar({ length: 20 }).notNull(),
	confidence: varchar({ length: 20 }).notNull(),
	reasoning: text(),
	algorithmVersion: varchar("algorithm_version", { length: 10 }).notNull(),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_ipo_scores_calculated").using("btree", table.calculatedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_ipo_scores_ipo_id").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "ipo_scores_ipo_id_fkey"
		}).onDelete("cascade"),
	unique("ipo_scores_ipo_id_calculated_at_key").on(table.ipoId, table.calculatedAt),
	check("ipo_scores_total_score_check", sql`(total_score >= 0) AND (total_score <= 100)`),
	check("ipo_scores_fundamental_score_check", sql`(fundamental_score >= 0) AND (fundamental_score <= 25)`),
	check("ipo_scores_sentiment_score_check", sql`(sentiment_score >= 0) AND (sentiment_score <= 25)`),
	check("ipo_scores_subscription_score_check", sql`(subscription_score >= 0) AND (subscription_score <= 25)`),
	check("ipo_scores_sector_score_check", sql`(sector_score >= 0) AND (sector_score <= 25)`),
	check("ipo_scores_verdict_check", sql`(verdict)::text = ANY ((ARRAY['APPLY'::character varying, 'CONSIDER'::character varying, 'SKIP'::character varying])::text[])`),
	check("ipo_scores_confidence_check", sql`(confidence)::text = ANY ((ARRAY['HIGH'::character varying, 'MEDIUM'::character varying, 'LOW'::character varying])::text[])`),
]);

export const ipoFinancials = pgTable("ipo_financials", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	revenueFy1: numeric("revenue_fy1", { precision: 12, scale:  2 }),
	revenueFy2: numeric("revenue_fy2", { precision: 12, scale:  2 }),
	revenueFy3: numeric("revenue_fy3", { precision: 12, scale:  2 }),
	profitFy1: numeric("profit_fy1", { precision: 12, scale:  2 }),
	profitFy2: numeric("profit_fy2", { precision: 12, scale:  2 }),
	profitFy3: numeric("profit_fy3", { precision: 12, scale:  2 }),
	peRatio: numeric("pe_ratio", { precision: 8, scale:  2 }),
	pbRatio: numeric("pb_ratio", { precision: 8, scale:  2 }),
	roePercentage: numeric("roe_percentage", { precision: 5, scale:  2 }),
	rocePercentage: numeric("roce_percentage", { precision: 5, scale:  2 }),
	debtToEquity: numeric("debt_to_equity", { precision: 8, scale:  2 }),
	industryPe: numeric("industry_pe", { precision: 8, scale:  2 }),
	peerCompanies: text("peer_companies").array(),
	financialYearEnd: varchar("financial_year_end", { length: 10 }),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp("updated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_ipo_financials_ipo_id").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "ipo_financials_ipo_id_fkey"
		}).onDelete("cascade"),
	unique("ipo_financials_ipo_id_key").on(table.ipoId),
]);

export const financialData = pgTable("financial_data", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	revenueFy2022: numeric("revenue_fy2022", { precision: 12, scale:  2 }),
	revenueFy2023: numeric("revenue_fy2023", { precision: 12, scale:  2 }),
	revenueFy2024: numeric("revenue_fy2024", { precision: 12, scale:  2 }),
	profitFy2022: numeric("profit_fy2022", { precision: 12, scale:  2 }),
	profitFy2023: numeric("profit_fy2023", { precision: 12, scale:  2 }),
	profitFy2024: numeric("profit_fy2024", { precision: 12, scale:  2 }),
	netWorth: numeric("net_worth", { precision: 12, scale:  2 }),
	peRatio: numeric("pe_ratio", { precision: 10, scale:  2 }),
	eps: numeric({ precision: 10, scale:  2 }),
	roe: numeric({ precision: 5, scale:  2 }),
	debtToEquity: numeric("debt_to_equity", { precision: 10, scale:  2 }),
	reservesAndSurplus: numeric("reserves_and_surplus", { precision: 12, scale:  2 }),
	totalAssets: numeric("total_assets", { precision: 12, scale:  2 }),
	totalBorrowing: numeric("total_borrowing", { precision: 12, scale:  2 }),
}, (table) => [
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "financial_data_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
	unique("financial_data_ipo_id_unique").on(table.ipoId),
]);

export const listingPerformance = pgTable("listing_performance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	listingPrice: integer("listing_price").notNull(),
	issuePrice: integer("issue_price").notNull(),
	listingGainPercent: numeric("listing_gain_percent", { precision: 5, scale:  2 }).notNull(),
	currentPrice: integer("current_price"),
	currentGainPercent: numeric("current_gain_percent", { precision: 5, scale:  2 }),
	lastUpdated: timestamp("last_updated", { mode: 'string' }).defaultNow().notNull(),
	currentPriceBse: integer("current_price_bse"),
	currentPriceNse: integer("current_price_nse"),
}, (table) => [
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "listing_performance_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
	unique("listing_performance_ipo_id_unique").on(table.ipoId),
]);

export const gmpRecords = pgTable("gmp_records", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	timestamp: timestamp({ mode: 'string' }).notNull(),
	gmp: integer().notNull(),
	expectedListingPrice: integer("expected_listing_price"),
	subjectRate: integer("subject_rate"),
	kostakRate: integer("kostak_rate"),
	saudaDetails: text("sauda_details"),
	source: varchar({ length: 100 }).notNull(),
}, (table) => [
	index("idx_gmp_records_ipo_timestamp").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.timestamp.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "gmp_records_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
]);

export const peerCompanies = pgTable("peer_companies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	companyName: varchar("company_name", { length: 255 }).notNull(),
	sector: varchar({ length: 100 }),
	isListed: boolean("is_listed").notNull(),
	peRatio: numeric("pe_ratio", { precision: 10, scale:  2 }),
	eps: numeric({ precision: 10, scale:  2 }),
	dilutedEps: numeric("diluted_eps", { precision: 10, scale:  2 }),
	ronw: numeric({ precision: 5, scale:  2 }),
	nav: numeric({ precision: 10, scale:  2 }),
	pbvRatio: numeric("pbv_ratio", { precision: 10, scale:  2 }),
	financialStatementType: financialStatementType("financial_statement_type"),
	dataSource: varchar("data_source", { length: 100 }),
	lastUpdated: timestamp("last_updated", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "peer_companies_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
]);

export const subscriptions = pgTable("subscriptions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	timestamp: timestamp({ mode: 'string' }).notNull(),
	qibSubscription: numeric("qib_subscription", { precision: 10, scale:  2 }),
	niiSubscription: numeric("nii_subscription", { precision: 10, scale:  2 }),
	retailSubscription: numeric("retail_subscription", { precision: 10, scale:  2 }),
	totalSubscription: numeric("total_subscription", { precision: 10, scale:  2 }),
	employeeSubscription: numeric("employee_subscription", { precision: 10, scale:  2 }),
	othersSubscription: numeric("others_subscription", { precision: 10, scale:  2 }),
	anchorInvestorSubscription: numeric("anchor_investor_subscription", { precision: 10, scale:  2 }),
	retailHniSubscription: numeric("retail_hni_subscription", { precision: 10, scale:  2 }),
	retailOthersSubscription: numeric("retail_others_subscription", { precision: 10, scale:  2 }),
	bNiiSubscription: numeric("b_nii_subscription", { precision: 10, scale:  2 }),
	sNiiSubscription: numeric("s_nii_subscription", { precision: 10, scale:  2 }),
	totalApplications: integer("total_applications"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalSharesBid: bigint("total_shares_bid", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharesOffered: bigint("shares_offered", { mode: "number" }),
}, (table) => [
	index("idx_subscriptions_ipo_timestamp").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.timestamp.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "subscriptions_ipo_id_ipos_id_fk"
		}).onDelete("cascade"),
]);

export const affiliateClicks = pgTable("affiliate_clicks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id"),
	broker: varchar({ length: 50 }).notNull(),
	source: varchar({ length: 50 }).notNull(),
	userSession: varchar("user_session", { length: 255 }),
	clickedAt: timestamp("clicked_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_affiliate_clicks_broker").using("btree", table.broker.asc().nullsLast().op("text_ops")),
	index("idx_affiliate_clicks_clicked_at").using("btree", table.clickedAt.asc().nullsLast().op("timestamp_ops")),
	index("idx_affiliate_clicks_ipo_id").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "affiliate_clicks_ipo_id_ipos_id_fk"
		}).onDelete("set null"),
]);

export const scoreHistory = pgTable("score_history", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	totalScore: integer("total_score").notNull(),
	fundamentalScore: integer("fundamental_score").notNull(),
	sentimentScore: integer("sentiment_score").notNull(),
	subscriptionScore: integer("subscription_score").notNull(),
	sectorScore: integer("sector_score").notNull(),
	confidenceLevel: varchar("confidence_level", { length: 20 }).notNull(),
	algorithmVersion: varchar("algorithm_version", { length: 10 }).default('1.0').notNull(),
	scoreChange: integer("score_change"),
	changeReason: text("change_reason"),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_score_history_ipo_time").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.calculatedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_score_history_version").using("btree", table.algorithmVersion.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipoDetails.id],
			name: "score_history_ipo_id_fkey"
		}).onDelete("cascade"),
	check("score_history_total_score_check", sql`(total_score >= 0) AND (total_score <= 100)`),
	check("score_history_fundamental_score_check", sql`(fundamental_score >= 0) AND (fundamental_score <= 40)`),
	check("score_history_sentiment_score_check", sql`(sentiment_score >= 0) AND (sentiment_score <= 30)`),
	check("score_history_subscription_score_check", sql`(subscription_score >= 0) AND (subscription_score <= 20)`),
	check("score_history_sector_score_check", sql`(sector_score >= 0) AND (sector_score <= 10)`),
	check("score_history_confidence_level_check", sql`(confidence_level)::text = ANY ((ARRAY['HIGH'::character varying, 'MEDIUM'::character varying, 'LOW'::character varying])::text[])`),
]);

export const scorePerformance = pgTable("score_performance", {
	id: uuid().default(sql`uuid_generate_v4()`).primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	predictedScore: integer("predicted_score").notNull(),
	actualListingGain: numeric("actual_listing_gain", { precision: 10, scale:  2 }),
	predictionAccuracy: numeric("prediction_accuracy", { precision: 5, scale:  2 }),
	analyzedAt: timestamp("analyzed_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdAt: timestamp("created_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_score_performance_analyzed").using("btree", table.analyzedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_score_performance_ipo").using("btree", table.ipoId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipoDetails.id],
			name: "score_performance_ipo_id_fkey"
		}).onDelete("cascade"),
	check("score_performance_predicted_score_check", sql`(predicted_score >= 0) AND (predicted_score <= 100)`),
]);

export const gmpTracking = pgTable("gmp_tracking", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	ipoId: uuid("ipo_id").notNull(),
	gmpAmount: numeric("gmp_amount", { precision: 10, scale:  2 }).notNull(),
	gmpPercentage: numeric("gmp_percentage", { precision: 5, scale:  2 }).notNull(),
	expectedListingPrice: numeric("expected_listing_price", { precision: 10, scale:  2 }),
	kostakRate: numeric("kostak_rate", { precision: 10, scale:  2 }),
	subjectToSauda: numeric("subject_to_sauda", { precision: 10, scale:  2 }),
	source: varchar({ length: 50 }).notNull(),
	sourceUrl: varchar("source_url", { length: 500 }),
	confidenceScore: integer("confidence_score").notNull(),
	recordedAt: timestamp("recorded_at", { mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
	index("idx_gmp_tracking_ipo_time").using("btree", table.ipoId.asc().nullsLast().op("timestamp_ops"), table.recordedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_gmp_tracking_recorded_at").using("btree", table.recordedAt.desc().nullsFirst().op("timestamp_ops")),
	index("idx_gmp_tracking_source").using("btree", table.source.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.ipoId],
			foreignColumns: [ipos.id],
			name: "gmp_tracking_ipo_id_fkey"
		}).onDelete("cascade"),
	check("gmp_tracking_source_check", sql`(source)::text = ANY ((ARRAY['IPOWATCH'::character varying, 'INVESTORGAIN'::character varying, 'CHITTORGARH'::character varying, 'MANUAL'::character varying])::text[])`),
	check("gmp_tracking_confidence_score_check", sql`(confidence_score >= 1) AND (confidence_score <= 100)`),
	check("gmp_tracking_check_positive_gmp", sql`gmp_amount >= (0)::numeric`),
]);
export const pgStatStatementsInfo = pgView("pg_stat_statements_info", {	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	dealloc: bigint({ mode: "number" }),
	statsReset: timestamp("stats_reset", { withTimezone: true, mode: 'string' }),
}).as(sql`SELECT dealloc, stats_reset FROM pg_stat_statements_info() pg_stat_statements_info(dealloc, stats_reset)`);

export const pgStatStatements = pgView("pg_stat_statements", {	// TODO: failed to parse database type 'oid'
	userid: unknown("userid"),
	// TODO: failed to parse database type 'oid'
	dbid: unknown("dbid"),
	toplevel: boolean(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	queryid: bigint({ mode: "number" }),
	query: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	plans: bigint({ mode: "number" }),
	totalPlanTime: doublePrecision("total_plan_time"),
	minPlanTime: doublePrecision("min_plan_time"),
	maxPlanTime: doublePrecision("max_plan_time"),
	meanPlanTime: doublePrecision("mean_plan_time"),
	stddevPlanTime: doublePrecision("stddev_plan_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	calls: bigint({ mode: "number" }),
	totalExecTime: doublePrecision("total_exec_time"),
	minExecTime: doublePrecision("min_exec_time"),
	maxExecTime: doublePrecision("max_exec_time"),
	meanExecTime: doublePrecision("mean_exec_time"),
	stddevExecTime: doublePrecision("stddev_exec_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	rows: bigint({ mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharedBlksHit: bigint("shared_blks_hit", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharedBlksRead: bigint("shared_blks_read", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharedBlksDirtied: bigint("shared_blks_dirtied", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sharedBlksWritten: bigint("shared_blks_written", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	localBlksHit: bigint("local_blks_hit", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	localBlksRead: bigint("local_blks_read", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	localBlksDirtied: bigint("local_blks_dirtied", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	localBlksWritten: bigint("local_blks_written", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tempBlksRead: bigint("temp_blks_read", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tempBlksWritten: bigint("temp_blks_written", { mode: "number" }),
	blkReadTime: doublePrecision("blk_read_time"),
	blkWriteTime: doublePrecision("blk_write_time"),
	tempBlkReadTime: doublePrecision("temp_blk_read_time"),
	tempBlkWriteTime: doublePrecision("temp_blk_write_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	walRecords: bigint("wal_records", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	walFpi: bigint("wal_fpi", { mode: "number" }),
	walBytes: numeric("wal_bytes"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	jitFunctions: bigint("jit_functions", { mode: "number" }),
	jitGenerationTime: doublePrecision("jit_generation_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	jitInliningCount: bigint("jit_inlining_count", { mode: "number" }),
	jitInliningTime: doublePrecision("jit_inlining_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	jitOptimizationCount: bigint("jit_optimization_count", { mode: "number" }),
	jitOptimizationTime: doublePrecision("jit_optimization_time"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	jitEmissionCount: bigint("jit_emission_count", { mode: "number" }),
	jitEmissionTime: doublePrecision("jit_emission_time"),
}).as(sql`SELECT userid, dbid, toplevel, queryid, query, plans, total_plan_time, min_plan_time, max_plan_time, mean_plan_time, stddev_plan_time, calls, total_exec_time, min_exec_time, max_exec_time, mean_exec_time, stddev_exec_time, rows, shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written, local_blks_hit, local_blks_read, local_blks_dirtied, local_blks_written, temp_blks_read, temp_blks_written, blk_read_time, blk_write_time, temp_blk_read_time, temp_blk_write_time, wal_records, wal_fpi, wal_bytes, jit_functions, jit_generation_time, jit_inlining_count, jit_inlining_time, jit_optimization_count, jit_optimization_time, jit_emission_count, jit_emission_time FROM pg_stat_statements(true) pg_stat_statements(userid, dbid, toplevel, queryid, query, plans, total_plan_time, min_plan_time, max_plan_time, mean_plan_time, stddev_plan_time, calls, total_exec_time, min_exec_time, max_exec_time, mean_exec_time, stddev_exec_time, rows, shared_blks_hit, shared_blks_read, shared_blks_dirtied, shared_blks_written, local_blks_hit, local_blks_read, local_blks_dirtied, local_blks_written, temp_blks_read, temp_blks_written, blk_read_time, blk_write_time, temp_blk_read_time, temp_blk_write_time, wal_records, wal_fpi, wal_bytes, jit_functions, jit_generation_time, jit_inlining_count, jit_inlining_time, jit_optimization_count, jit_optimization_time, jit_emission_count, jit_emission_time)`);

export const pipelineHealthSummary = pgView("pipeline_health_summary", {	source: varchar({ length: 50 }),
	pipelineType: varchar("pipeline_type", { length: 20 }),
	status: varchar({ length: 20 }),
	lastSuccessAt: timestamp("last_success_at", { mode: 'string' }),
	consecutiveFailures: integer("consecutive_failures"),
	freshnessStatus: varchar("freshness_status"),
	recordsProcessed: integer("records_processed"),
	executionTimeMs: integer("execution_time_ms"),
}).as(sql`SELECT source, pipeline_type, status, last_success_at, consecutive_failures, get_data_freshness_status(last_success_at) AS freshness_status, records_processed, execution_time_ms FROM pipeline_status ORDER BY last_run_at DESC`);

export const gmpCurrent = pgMaterializedView("gmp_current", {	ipoId: uuid("ipo_id"),
	avgGmpAmount: numeric("avg_gmp_amount"),
	maxGmpAmount: numeric("max_gmp_amount"),
	minGmpAmount: numeric("min_gmp_amount"),
	avgGmpPercentage: numeric("avg_gmp_percentage"),
	maxGmpPercentage: numeric("max_gmp_percentage"),
	minGmpPercentage: numeric("min_gmp_percentage"),
	avgExpectedListingPrice: numeric("avg_expected_listing_price"),
	avgKostakRate: numeric("avg_kostak_rate"),
	avgSubjectToSauda: numeric("avg_subject_to_sauda"),
	avgConfidenceScore: numeric("avg_confidence_score"),
	sources: varchar(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	totalRecords: bigint("total_records", { mode: "number" }),
	lastUpdatedAt: timestamp("last_updated_at", { mode: 'string' }),
}).as(sql`SELECT ipo_id, avg(gmp_amount) AS avg_gmp_amount, max(gmp_amount) AS max_gmp_amount, min(gmp_amount) AS min_gmp_amount, avg(gmp_percentage) AS avg_gmp_percentage, max(gmp_percentage) AS max_gmp_percentage, min(gmp_percentage) AS min_gmp_percentage, avg(expected_listing_price) AS avg_expected_listing_price, avg(kostak_rate) AS avg_kostak_rate, avg(subject_to_sauda) AS avg_subject_to_sauda, avg(confidence_score) AS avg_confidence_score, array_agg(DISTINCT source) AS sources, count(*) AS total_records, max(recorded_at) AS last_updated_at FROM gmp_tracking WHERE recorded_at >= (now() - '24:00:00'::interval) GROUP BY ipo_id`);

export const currentIpoScores = pgMaterializedView("current_ipo_scores", {	scoreId: uuid("score_id"),
	ipoId: uuid("ipo_id"),
	companyName: varchar("company_name", { length: 255 }),
	issueType: varchar("issue_type", { length: 20 }),
	totalScore: integer("total_score"),
	fundamentalScore: integer("fundamental_score"),
	sentimentScore: integer("sentiment_score"),
	subscriptionScore: integer("subscription_score"),
	sectorScore: integer("sector_score"),
	confidenceLevel: varchar("confidence_level", { length: 20 }),
	algorithmVersion: varchar("algorithm_version", { length: 10 }),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }),
	verdict: text(),
	verdictColor: text("verdict_color"),
}).as(sql`SELECT DISTINCT ON (sh.ipo_id) sh.id AS score_id, sh.ipo_id, i.company_name, ipod.issue_type, sh.total_score, sh.fundamental_score, sh.sentiment_score, sh.subscription_score, sh.sector_score, sh.confidence_level, sh.algorithm_version, sh.calculated_at, CASE WHEN sh.total_score >= 70 THEN 'Strong Buy'::text WHEN sh.total_score >= 50 THEN 'Consider'::text WHEN sh.total_score >= 30 THEN 'Risky'::text ELSE 'Avoid'::text END AS verdict, CASE WHEN sh.total_score >= 70 THEN '#10B981'::text WHEN sh.total_score >= 50 THEN '#F59E0B'::text WHEN sh.total_score >= 30 THEN '#EF4444'::text ELSE '#991B1B'::text END AS verdict_color FROM score_history sh JOIN ipo_details ipod ON sh.ipo_id = ipod.id JOIN ipos i ON ipod.ipo_id = i.id ORDER BY sh.ipo_id, sh.calculated_at DESC`);