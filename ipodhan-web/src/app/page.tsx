'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Hero, StatsBar, IPOTabs } from '@/components/home';
import { IPOCard } from '@/components/ipo';
import { IPOListSkeleton } from '@/components/common';
import { useIPOStore } from '@/stores/ipoStore';
import type { TabType } from '@/types/ipo';

/**
 * HomePage Component
 * Main landing page with IPO listings
 */
export default function HomePage() {
  const router = useRouter();
  const { ipos, scores, loading, error, fetchIPOs, setFilter, fetchIPOScore } = useIPOStore();

  const [activeTab, setActiveTab] = useState('live');

  // Mock stats - will be replaced with real data
  const [stats] = useState({
    totalIPOsThisYear: 45,
    averageListingGain: 12.5,
    topPerformingIPO: 'ABC Technologies',
    currentGMPLeader: 'XYZ Limited',
  });

  // Tab configuration
  const tabs: TabType[] = [
    {
      id: 'live',
      label: 'Live IPOs',
      count: ipos.filter(ipo => ipo.status === 'LIVE').length,
      status: 'LIVE',
    },
    {
      id: 'upcoming',
      label: 'Upcoming IPOs',
      count: ipos.filter(ipo => ipo.status === 'UPCOMING').length,
      status: 'UPCOMING',
    },
    {
      id: 'closed',
      label: 'Closed IPOs',
      count: ipos.filter(ipo => ipo.status === 'CLOSED').length,
      status: 'CLOSED',
    },
  ];

  // Load IPOs on mount
  useEffect(() => {
    fetchIPOs({ status: 'LIVE' });
  }, [fetchIPOs]);

  // Fetch scores for displayed IPOs
  useEffect(() => {
    ipos.forEach(ipo => {
      if (!scores[ipo.id]) {
        fetchIPOScore(ipo.id);
      }
    });
  }, [ipos, scores, fetchIPOScore]);

  // Handle tab change
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      setFilter({ status: tab.status });
    }
  };

  // Handle search
  const handleSearch = (query: string) => {
    router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  // Get top IPO
  const topIPO =
    ipos.length > 0 && scores[ipos[0].id]
      ? {
          name: ipos[0].companyName,
          score: scores[ipos[0].id].totalScore,
        }
      : undefined;

  // Filter IPOs by active tab
  const filteredIPOs = ipos.filter(ipo => {
    const tab = tabs.find(t => t.id === activeTab);
    return tab && ipo.status === tab.status;
  });

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <Hero
        liveIPOCount={tabs.find(t => t.id === 'live')?.count || 0}
        topIPO={topIPO}
        onSearch={handleSearch}
      />

      {/* Stats Bar */}
      <StatsBar
        totalIPOsThisYear={stats.totalIPOsThisYear}
        averageListingGain={stats.averageListingGain}
        topPerformingIPO={stats.topPerformingIPO}
        currentGMPLeader={stats.currentGMPLeader}
      />

      {/* Tabs */}
      <IPOTabs tabs={tabs} activeTab={activeTab} onTabChange={handleTabChange} />

      {/* IPO Grid */}
      <section className="max-w-7xl mx-auto px-4 py-8">
        {error && (
          <div
            className="bg-danger-light border border-danger text-danger-dark px-4 py-3 rounded mb-6"
            role="alert"
          >
            <p className="font-medium">Error loading IPOs</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading ? (
          <IPOListSkeleton count={6} />
        ) : filteredIPOs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">No {activeTab} IPOs found</p>
          </div>
        ) : (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            role="list"
            aria-label={`${activeTab} IPOs`}
          >
            {filteredIPOs.map(ipo => (
              <div key={ipo.id} role="listitem">
                <IPOCard
                  ipo={ipo}
                  score={scores[ipo.id]}
                  showSubscription={ipo.status === 'LIVE'}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
