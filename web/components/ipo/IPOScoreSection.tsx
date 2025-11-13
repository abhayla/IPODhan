/**
 * IPOScoreSection Component (Story 4.7 - AC#4)
 * Displays comprehensive IPO scoring information on detail page
 */

'use client';

import { AlertCircle, TrendingUp } from 'lucide-react';
import type { IPOScore } from '@/lib/db/types';
import { ScoreBadge } from './ScoreBadge';
import { VerdictBadge } from './VerdictBadge';
import { ConfidenceBadge } from './ConfidenceBadge';
import { ScoreBreakdown, type ScoreBreakdownData } from './ScoreBreakdown';
import {
  formatComponentScore,
  getScorePercentage,
  getScoreBgClass,
  getScoreTextClass,
} from '@/lib/utils/score-utils';
import { format } from 'date-fns';

interface IPOScoreSectionProps {
  score: IPOScore | null;
}

/**
 * Component score breakdown bar
 */
function ScoreBreakdownBar({
  label,
  score,
  maxScore = 25,
}: {
  label: string;
  score: number;
  maxScore?: number;
}) {
  const percentage = getScorePercentage(score, maxScore);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className={`text-sm font-semibold ${getScoreTextClass(score * 4)}`}>
          {formatComponentScore(score)}
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${getScoreBgClass(score * 4)}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Main IPO Score Section
 */
export function IPOScoreSection({ score }: IPOScoreSectionProps) {
  // If no score, show "Score Pending" state
  if (!score) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 p-8">
        <div className="flex flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground/50" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">Score Pending</h3>
            <p className="text-sm text-muted-foreground mt-1">
              IPODhan score is being calculated. Please check back later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-bold text-foreground">IPODhan Score</h3>
          </div>
          <p className="text-sm text-muted-foreground">
            AI-powered analysis based on multiple data points
          </p>
        </div>
        <ScoreBadge score={score.totalScore} size="lg" />
      </div>

      {/* Verdict and Confidence */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Verdict:</span>
          <VerdictBadge verdict={score.verdict} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Confidence:</span>
          <ConfidenceBadge confidence={score.confidence} />
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="space-y-4 pt-4">
        <h4 className="text-sm font-semibold text-foreground">Score Breakdown</h4>
        <div className="grid gap-4 md:grid-cols-2">
          <ScoreBreakdownBar
            label="Fundamental Score"
            score={score.fundamentalScore}
          />
          <ScoreBreakdownBar
            label="Sentiment Score"
            score={score.sentimentScore}
          />
          <ScoreBreakdownBar
            label="Subscription Score"
            score={score.subscriptionScore}
          />
          <ScoreBreakdownBar
            label="Sector Score"
            score={score.sectorScore}
          />
        </div>
      </div>

      {/* 5-Component Radar Chart (Phase 2: Data Intelligence) */}
      <div className="space-y-4 pt-4 border-t">
        <h4 className="text-sm font-semibold text-foreground">Component Analysis</h4>
        <div className="flex justify-center">
          <ScoreBreakdown
            data={{
              // Map existing 4-component scores (0-25 each) to 5-component system (0-10 total)
              // Using proportional scaling for visualization
              financialStrength: (score.fundamentalScore / 25) * 3, // 0-3
              valuation: (score.sectorScore / 25) * 2, // 0-2
              subscriptionDemand: (score.subscriptionScore / 25) * 2, // 0-2
              marketPerformance: (score.sentimentScore / 25) * 2, // 0-2
              fundamentals: (score.fundamentalScore / 25) * 1, // 0-1
              total: score.totalScore / 10, // Convert 0-100 to 0-10
              rating: score.verdict,
              confidence: score.confidence === 'HIGH' ? 90 : score.confidence === 'MEDIUM' ? 70 : 50,
            }}
          />
        </div>
      </div>

      {/* Reasoning */}
      {score.reasoning && (
        <div className="space-y-2 pt-4 border-t">
          <h4 className="text-sm font-semibold text-foreground">Analysis</h4>
          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
            {score.reasoning}
          </p>
        </div>
      )}

      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-4 pt-4 border-t text-xs text-muted-foreground">
        <span>
          Calculated: {format(new Date(score.calculatedAt), 'MMM dd, yyyy HH:mm')}
        </span>
        <span className="hidden sm:inline">•</span>
        <span>Algorithm v{score.algorithmVersion}</span>
      </div>
    </div>
  );
}
