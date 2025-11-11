'use client';

import React, { useState, useEffect } from 'react';
import { TrendingUp, Flame, Eye, Zap, ChevronRight } from 'lucide-react';
import { AnimatedScore } from '@/components/ipo/AnimatedScore';
import { GMPSparkline } from '@/components/ipo/GMPSparkline';

/**
 * HotRightNow - Phase 3: Real-Time Experience
 *
 * Displays algorithmically-ranked "hot" IPOs based on:
 * - Subscription momentum (rapid increase)
 * - GMP trending (upward price movement)
 * - Viewer interest (high concurrent views)
 * - Score improvements (quality increasing)
 * - Recency (newly opened or closing soon)
 *
 * Features:
 * - Real-time hotness ranking
 * - Compact IPO cards with sparklines
 * - Live indicators
 * - Auto-refresh every 60s
 * - Smooth transitions
 */

export interface HotIPO {
  id: string;
  companyName: string;
  slug: string;
  score: number;
  gmp: number;
  gmpTrend: number[];  // 7-day trend
  subscription: number;
  subscriptionTrend: 'accelerating' | 'stable' | 'slowing';
  viewers: number;
  hotScore: number;    // Algorithm-calculated hotness (0-100)
  hotReason: string;   // "Subscription surging" | "GMP trending" | "High interest"
}

export interface HotRightNowProps {
  maxItems?: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // ms
  variant?: 'default' | 'compact';
  className?: string;
}

export function HotRightNow({
  maxItems = 5,
  autoRefresh = true,
  refreshInterval = 60000,
  variant = 'default',
  className = '',
}: HotRightNowProps) {
  const [hotIPOs, setHotIPOs] = useState<HotIPO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());

  // Mock data generator (replace with real API call)
  const fetchHotIPOs = async (): Promise<HotIPO[]> => {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Generate mock hot IPOs
    const companies = [
      'Tech Innovators Ltd',
      'Green Energy Solutions',
      'FinTech Dynamics Inc',
      'Healthcare Plus Ltd',
      'Manufacturing Pro Ltd',
    ];

    const reasons = [
      'Subscription surging',
      'GMP trending up',
      'High investor interest',
      'Closing soon',
      'Quality score rising',
    ];

    return companies.map((name, index) => ({
      id: `hot-ipo-${index}`,
      companyName: name,
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      score: 7.5 + Math.random() * 2,
      gmp: 100 + Math.random() * 150,
      gmpTrend: Array.from({ length: 7 }, () => 80 + Math.random() * 100),
      subscription: 5 + Math.random() * 15,
      subscriptionTrend: ['accelerating', 'stable', 'slowing'][
        Math.floor(Math.random() * 3)
      ] as any,
      viewers: Math.floor(200 + Math.random() * 400),
      hotScore: 70 + Math.random() * 30,
      hotReason: reasons[Math.floor(Math.random() * reasons.length)],
    }));
  };

  // Initial load and auto-refresh
  useEffect(() => {
    const loadHotIPOs = async () => {
      setIsLoading(true);
      const ipos = await fetchHotIPOs();
      setHotIPOs(ipos.slice(0, maxItems));
      setLastUpdate(Date.now());
      setIsLoading(false);
    };

    loadHotIPOs();

    if (autoRefresh) {
      const interval = setInterval(loadHotIPOs, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [maxItems, autoRefresh, refreshInterval]);

  // Format last update time
  const getLastUpdateText = (): string => {
    const seconds = Math.floor((Date.now() - lastUpdate) / 1000);
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  // Compact variant for sidebar
  if (variant === 'compact') {
    return (
      <div className={`hot-right-now-compact ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-danger" />
            <span className="text-sm font-semibold text-foreground">Hot Right Now</span>
          </div>
          {autoRefresh && (
            <div className="text-xs text-muted-foreground">{getLastUpdateText()}</div>
          )}
        </div>

        {/* Compact list */}
        <div className="space-y-2">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            hotIPOs.map((ipo, index) => (
              <div
                key={ipo.id}
                className="flex items-center gap-2 p-2 rounded-md border border-border hover:bg-muted/50 transition-colors cursor-pointer"
              >
                {/* Rank */}
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-danger/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-danger">{index + 1}</span>
                </div>

                {/* Company name */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {ipo.companyName}
                  </div>
                  <div className="text-xs text-muted-foreground">{ipo.hotReason}</div>
                </div>

                {/* Score */}
                <div className="flex-shrink-0 text-sm font-semibold text-success">
                  {ipo.score.toFixed(1)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Default variant (full section)
  return (
    <div className={`hot-right-now-default ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-danger/10">
            <Flame className="w-5 h-5 text-danger" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Hot Right Now</h2>
            <p className="text-sm text-muted-foreground">
              Trending IPOs based on live activity
            </p>
          </div>
        </div>

        {/* Auto-refresh indicator */}
        {autoRefresh && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Zap className="w-3.5 h-3.5" />
            <span>Updated {getLastUpdateText()}</span>
          </div>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-sm text-muted-foreground">Loading hot IPOs...</div>
        </div>
      )}

      {/* Hot IPOs Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 gap-4">
          {hotIPOs.map((ipo, index) => (
            <div
              key={ipo.id}
              className="relative rounded-lg border border-border bg-card p-4 hover:border-danger/50 transition-all hover:shadow-lg cursor-pointer group"
            >
              {/* Hot rank badge */}
              <div className="absolute -top-2 -left-2 w-8 h-8 rounded-full bg-danger text-white flex items-center justify-center font-bold text-sm shadow-lg">
                {index + 1}
              </div>

              {/* Content */}
              <div className="flex items-start gap-4">
                {/* Left: Company info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-foreground mb-1">
                        {ipo.companyName}
                      </h3>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Flame className="w-3 h-3 text-danger" />
                        <span>{ipo.hotReason}</span>
                      </div>
                    </div>

                    {/* Score */}
                    <div className="flex flex-col items-end">
                      <div className="text-2xl font-bold text-success">
                        <AnimatedScore value={ipo.score} decimals={1} />
                      </div>
                      <div className="text-xs text-muted-foreground">Score</div>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 mt-3">
                    {/* Subscription */}
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      <div>
                        <div className="text-xs text-muted-foreground">Subscription</div>
                        <div className="text-sm font-semibold text-foreground">
                          <AnimatedScore value={ipo.subscription} decimals={1} suffix="x" />
                        </div>
                      </div>
                    </div>

                    {/* GMP */}
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-4 h-4 text-accent" />
                      <div>
                        <div className="text-xs text-muted-foreground">GMP</div>
                        <div className="text-sm font-semibold text-foreground">
                          ₹{ipo.gmp.toFixed(0)}
                        </div>
                      </div>
                    </div>

                    {/* Viewers */}
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-4 h-4 text-danger" />
                      <div>
                        <div className="text-xs text-muted-foreground">Watching</div>
                        <div className="text-sm font-semibold text-foreground">
                          {ipo.viewers}
                        </div>
                      </div>
                    </div>

                    {/* GMP Sparkline */}
                    <div className="flex-1 min-w-[100px]">
                      <GMPSparkline gmpData={ipo.gmpTrend} height={32} />
                    </div>
                  </div>
                </div>

                {/* Arrow icon */}
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
              </div>

              {/* Hotness meter */}
              <div className="mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Hotness:</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-danger/70 to-danger rounded-full transition-all duration-500"
                      style={{ width: `${ipo.hotScore}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono font-semibold text-danger">
                    {ipo.hotScore.toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default HotRightNow;
