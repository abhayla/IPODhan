import { relations } from "drizzle-orm/relations";
import { ipos, ipoReviews, documents, gmpHistory, subscriptionData, users, userWatchlist, ipoDetails, registrars, ipoScores, ipoFinancials, financialData, listingPerformance, gmpRecords, peerCompanies, subscriptions, affiliateClicks, scoreHistory, scorePerformance, gmpTracking } from "./schema";

export const ipoReviewsRelations = relations(ipoReviews, ({one}) => ({
	ipo: one(ipos, {
		fields: [ipoReviews.ipoId],
		references: [ipos.id]
	}),
}));

export const iposRelations = relations(ipos, ({one, many}) => ({
	ipoReviews: many(ipoReviews),
	documents: many(documents),
	gmpHistories: many(gmpHistory),
	subscriptionData: many(subscriptionData),
	userWatchlists: many(userWatchlist),
	ipoDetails: many(ipoDetails),
	registrar: one(registrars, {
		fields: [ipos.registrarId],
		references: [registrars.id]
	}),
	ipoScores: many(ipoScores),
	ipoFinancials: many(ipoFinancials),
	financialData: many(financialData),
	listingPerformances: many(listingPerformance),
	gmpRecords: many(gmpRecords),
	peerCompanies: many(peerCompanies),
	subscriptions: many(subscriptions),
	affiliateClicks: many(affiliateClicks),
	gmpTrackings: many(gmpTracking),
}));

export const documentsRelations = relations(documents, ({one}) => ({
	ipo: one(ipos, {
		fields: [documents.ipoId],
		references: [ipos.id]
	}),
}));

export const gmpHistoryRelations = relations(gmpHistory, ({one}) => ({
	ipo: one(ipos, {
		fields: [gmpHistory.ipoId],
		references: [ipos.id]
	}),
}));

export const subscriptionDataRelations = relations(subscriptionData, ({one}) => ({
	ipo: one(ipos, {
		fields: [subscriptionData.ipoId],
		references: [ipos.id]
	}),
}));

export const userWatchlistRelations = relations(userWatchlist, ({one}) => ({
	user: one(users, {
		fields: [userWatchlist.userId],
		references: [users.id]
	}),
	ipo: one(ipos, {
		fields: [userWatchlist.ipoId],
		references: [ipos.id]
	}),
}));

export const usersRelations = relations(users, ({many}) => ({
	userWatchlists: many(userWatchlist),
}));

export const ipoDetailsRelations = relations(ipoDetails, ({one, many}) => ({
	ipo: one(ipos, {
		fields: [ipoDetails.ipoId],
		references: [ipos.id]
	}),
	scoreHistories: many(scoreHistory),
	scorePerformances: many(scorePerformance),
}));

export const registrarsRelations = relations(registrars, ({many}) => ({
	ipos: many(ipos),
}));

export const ipoScoresRelations = relations(ipoScores, ({one}) => ({
	ipo: one(ipos, {
		fields: [ipoScores.ipoId],
		references: [ipos.id]
	}),
}));

export const ipoFinancialsRelations = relations(ipoFinancials, ({one}) => ({
	ipo: one(ipos, {
		fields: [ipoFinancials.ipoId],
		references: [ipos.id]
	}),
}));

export const financialDataRelations = relations(financialData, ({one}) => ({
	ipo: one(ipos, {
		fields: [financialData.ipoId],
		references: [ipos.id]
	}),
}));

export const listingPerformanceRelations = relations(listingPerformance, ({one}) => ({
	ipo: one(ipos, {
		fields: [listingPerformance.ipoId],
		references: [ipos.id]
	}),
}));

export const gmpRecordsRelations = relations(gmpRecords, ({one}) => ({
	ipo: one(ipos, {
		fields: [gmpRecords.ipoId],
		references: [ipos.id]
	}),
}));

export const peerCompaniesRelations = relations(peerCompanies, ({one}) => ({
	ipo: one(ipos, {
		fields: [peerCompanies.ipoId],
		references: [ipos.id]
	}),
}));

export const subscriptionsRelations = relations(subscriptions, ({one}) => ({
	ipo: one(ipos, {
		fields: [subscriptions.ipoId],
		references: [ipos.id]
	}),
}));

export const affiliateClicksRelations = relations(affiliateClicks, ({one}) => ({
	ipo: one(ipos, {
		fields: [affiliateClicks.ipoId],
		references: [ipos.id]
	}),
}));

export const scoreHistoryRelations = relations(scoreHistory, ({one}) => ({
	ipoDetail: one(ipoDetails, {
		fields: [scoreHistory.ipoId],
		references: [ipoDetails.id]
	}),
}));

export const scorePerformanceRelations = relations(scorePerformance, ({one}) => ({
	ipoDetail: one(ipoDetails, {
		fields: [scorePerformance.ipoId],
		references: [ipoDetails.id]
	}),
}));

export const gmpTrackingRelations = relations(gmpTracking, ({one}) => ({
	ipo: one(ipos, {
		fields: [gmpTracking.ipoId],
		references: [ipos.id]
	}),
}));