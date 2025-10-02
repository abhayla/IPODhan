'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ScoreDisplay, VerdictBadge, Button, DetailPageSkeleton } from '@/components/common';
import { useIPOStore } from '@/stores/ipoStore';

type TabId = 'overview' | 'subscription' | 'gmp' | 'financials' | 'analysis' | 'documents';

/**
 * IPO Detail Page
 * Displays comprehensive IPO information with 6 tabs
 */
export default function IPODetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const { currentIPO, currentScore, loading, error, fetchIPOById, fetchIPOScore } = useIPOStore();

  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Load IPO data on mount
  useEffect(() => {
    if (id) {
      fetchIPOById(id);
      fetchIPOScore(id);
    }
  }, [id, fetchIPOById, fetchIPOScore]);

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'subscription', label: 'Subscription' },
    { id: 'gmp', label: 'GMP' },
    { id: 'financials', label: 'Financials' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'documents', label: 'Documents' },
  ];

  if (loading) {
    return <DetailPageSkeleton />;
  }

  if (error || !currentIPO) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">IPO Not Found</h1>
          <p className="text-gray-600 mb-6">{error || 'The requested IPO could not be found.'}</p>
          <Button variant="primary" onClick={() => router.push('/')}>
            Back to Home
          </Button>
        </div>
      </div>
    );
  }

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: number) => {
    if (amount >= 10000000) {
      return `₹${(amount / 10000000).toFixed(2)} Cr`;
    }
    return `₹${amount.toLocaleString('en-IN')}`;
  };

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <Button variant="ghost" onClick={() => router.back()} leftIcon={<span>←</span>}>
            Back
          </Button>

          <div className="flex flex-col md:flex-row items-start md:items-center justify-between mt-4 gap-6">
            {/* Company Info */}
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">{currentIPO.companyName}</h1>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-gray-600">{currentIPO.symbol}</span>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    currentIPO.category === 'MAINBOARD'
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-purple-light text-purple-dark'
                  }`}
                >
                  {currentIPO.category}
                </span>
                <span
                  className={`text-xs px-2 py-1 rounded font-medium ${
                    currentIPO.status === 'LIVE'
                      ? 'bg-success-light text-success-dark'
                      : currentIPO.status === 'UPCOMING'
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {currentIPO.status}
                </span>
              </div>
              <p className="text-gray-600">Description placeholder for {currentIPO.companyName}</p>
            </div>

            {/* Score Display */}
            {currentScore && (
              <div className="text-center p-6 bg-gray-50 rounded-lg">
                <ScoreDisplay score={currentScore.totalScore} size="lg" />
                <div className="mt-3">
                  <VerdictBadge verdict={currentScore.verdict} score={currentScore.totalScore} />
                </div>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="flex gap-3 mt-6">
            <Button variant="primary">Download Forms</Button>
            <Button variant="outline">Check Allotment</Button>
            <Button variant="outline">Add to Watchlist</Button>
            <Button variant="ghost">Share IPO</Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-8 overflow-x-auto" role="tablist">
            {tabs.map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`py-4 px-2 font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'text-primary-600 border-b-2 border-primary-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'overview' && (
          <OverviewTab ipo={currentIPO} formatDate={formatDate} formatCurrency={formatCurrency} />
        )}
        {activeTab === 'subscription' && <SubscriptionTab ipoId={id} />}
        {activeTab === 'gmp' && <GMPTab ipoId={id} />}
        {activeTab === 'financials' && <FinancialsTab />}
        {activeTab === 'analysis' && <AnalysisTab score={currentScore} />}
        {activeTab === 'documents' && <DocumentsTab />}
      </div>
    </main>
  );
}

// Overview Tab Component
function OverviewTab({ ipo, formatDate, formatCurrency }: any) {
  const minInvestment = ipo.priceBand.high * ipo.lotSize;

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Key Metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-gray-500 text-sm mb-1">Issue Size</p>
            <p className="font-semibold text-lg">{formatCurrency(ipo.issueSize)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Price Band</p>
            <p className="font-semibold text-lg">
              ₹{ipo.priceBand.low} - ₹{ipo.priceBand.high}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Lot Size</p>
            <p className="font-semibold text-lg">{ipo.lotSize} shares</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Min Investment</p>
            <p className="font-semibold text-lg">{formatCurrency(minInvestment)}</p>
          </div>
        </div>
      </div>

      {/* Important Dates */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Important Dates</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <p className="text-gray-500 text-sm mb-1">Open Date</p>
            <p className="font-semibold">{formatDate(ipo.dates.open)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Close Date</p>
            <p className="font-semibold">{formatDate(ipo.dates.close)}</p>
          </div>
          <div>
            <p className="text-gray-500 text-sm mb-1">Listing Date</p>
            <p className="font-semibold">
              {ipo.dates.listing ? formatDate(ipo.dates.listing) : 'To be announced'}
            </p>
          </div>
        </div>
      </div>

      {/* Object of Issue */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Object of Issue</h2>
        <p className="text-gray-600">
          Information about fresh issue, OFS, and use of proceeds will be displayed here.
        </p>
      </div>
    </div>
  );
}

// Subscription Tab Component
function SubscriptionTab({ ipoId }: { ipoId: string }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Subscription Status</h2>
      <p className="text-gray-600">
        Real-time subscription data will be displayed here. Integration with subscription API pending.
      </p>
    </div>
  );
}

// GMP Tab Component
function GMPTab({ ipoId }: { ipoId: string }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Grey Market Premium</h2>
      <p className="text-gray-600">
        Historical GMP chart and current GMP data will be displayed here. Integration with GMP API pending.
      </p>
    </div>
  );
}

// Financials Tab Component
function FinancialsTab() {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Financial Performance</h2>
      <p className="text-gray-600">
        Revenue, profit, key ratios, and peer comparison data will be displayed here.
      </p>
    </div>
  );
}

// Analysis Tab Component
function AnalysisTab({ score }: any) {
  return (
    <div className="space-y-6">
      {/* Score Breakdown */}
      {score && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Score Breakdown</h2>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-700">Fundamentals (40%)</span>
                <span className="font-semibold">{score.components.fundamental}/40</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full">
                <div
                  className="h-full bg-primary-600 rounded-full"
                  style={{ width: `${(score.components.fundamental / 40) * 100}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-700">Market Sentiment (30%)</span>
                <span className="font-semibold">{score.components.sentiment}/30</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full">
                <div
                  className="h-full bg-primary-600 rounded-full"
                  style={{ width: `${(score.components.sentiment / 30) * 100}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-700">Subscription (20%)</span>
                <span className="font-semibold">{score.components.subscription}/20</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full">
                <div
                  className="h-full bg-primary-600 rounded-full"
                  style={{ width: `${(score.components.subscription / 20) * 100}%` }}
                ></div>
              </div>
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-gray-700">Sector Timing (10%)</span>
                <span className="font-semibold">{score.components.sector}/10</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full">
                <div
                  className="h-full bg-primary-600 rounded-full"
                  style={{ width: `${(score.components.sector / 10) * 100}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strengths and Risks */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Editorial Recommendation</h2>
        <p className="text-gray-600">
          Detailed analysis with strengths, risks, and key considerations will be displayed here.
        </p>
      </div>
    </div>
  );
}

// Documents Tab Component
function DocumentsTab() {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Documents & Forms</h2>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <span className="text-gray-700">DRHP/RHP Document</span>
          <Button variant="outline" size="sm">
            Download
          </Button>
        </div>
        <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <span className="text-gray-700">Application Forms</span>
          <Button variant="outline" size="sm">
            Download
          </Button>
        </div>
        <div className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
          <span className="text-gray-700">Company Presentation</span>
          <Button variant="outline" size="sm">
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
