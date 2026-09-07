/**
 * IPOScoreSection Component (Story 4.7 - AC#4)
 * Displays comprehensive IPO scoring information on detail page
 *
 * T-489: renders one IPOScoreDisplayModel (0-10 scale — the API's own
 * scale) regardless of whether it came from a stored editorial `ipo_scores`
 * row or a realtime calculation. See web/lib/adapters/ipo-score-display-adapter.ts.
 */

'use client';

import { AlertCircle, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import type { IPOScoreDisplayModel } from '@/lib/adapters/ipo-score-display-adapter';
import { ScoreBreakdown } from './ScoreBreakdown';

interface IPOScoreSectionProps {
  score: IPOScoreDisplayModel | null;
}

function scoreToneClass(percentage: number): { bg: string; barBg: string; text: string; border: string } {
  if (percentage >= 76) return { bg: 'bg-green-500/10', barBg: 'bg-green-500', text: 'text-green-600 dark:text-green-400', border: 'border-green-500/30' };
  if (percentage >= 51) return { bg: 'bg-yellow-500/10', barBg: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500/30' };
  if (percentage >= 26) return { bg: 'bg-orange-500/10', barBg: 'bg-orange-500', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/30' };
  return { bg: 'bg-red-500/10', barBg: 'bg-red-500', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30' };
}

/**
 * Component score breakdown bar
 */
function ScoreBreakdownBar({
  label,
  score,
  maxScore,
  note,
}: {
  label: string;
  score: number;
  maxScore: number;
  note?: string;
}) {
  const percentage = maxScore > 0 ? Math.min(100, Math.round((score / maxScore) * 100)) : 0;
  const tone = scoreToneClass(percentage);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className={`text-sm font-semibold ${tone.text}`}>
          {score}/{maxScore}
        </span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${tone.barBg}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {note && <p className="text-xs text-muted-foreground italic">{note}</p>}
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

  const totalPercentage = Math.round((score.totalScore / score.maxScore) * 100);
  const tone = scoreToneClass(totalPercentage);
  const caption =
    score.source === 'realtime'
      ? 'Computed from financial data, subscription demand, GMP and listing performance'
      : 'Editorial score';

  return (
    <div className="space-y-6 rounded-lg border bg-card p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-bold text-foreground">IPODhan Score</h3>
          </div>
          <p className="text-sm text-muted-foreground">{caption}</p>
        </div>
        <div
          className={`inline-flex items-center gap-1 font-semibold rounded-full border text-base px-4 py-1.5 ${tone.bg} ${tone.text} ${tone.border}`}
        >
          {score.totalScore}/{score.maxScore}
        </div>
      </div>

      {/* Rating and Confidence */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Rating:</span>
          <span className={`text-sm font-semibold ${tone.text}`}>{score.ratingLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Confidence:</span>
          <span className="text-sm font-medium text-foreground">{score.confidencePercent}%</span>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="space-y-4 pt-4">
        <h4 className="text-sm font-semibold text-foreground">Score Breakdown</h4>
        <div className="grid gap-4 md:grid-cols-2">
          {score.components.map((component) => (
            <ScoreBreakdownBar
              key={component.label}
              label={component.label}
              score={component.score}
              maxScore={component.maxScore}
              note={component.note}
            />
          ))}
        </div>
      </div>

      {/* 5-Component Radar Chart (Phase 2: Data Intelligence) */}
      <div className="space-y-4 pt-4 border-t">
        <h4 className="text-sm font-semibold text-foreground">Component Analysis</h4>
        <div className="flex justify-center">
          <ScoreBreakdown
            data={{
              financialStrength: score.components[0]?.score ?? 0,
              valuation: score.components[1]?.score ?? 0,
              subscriptionDemand: score.components[2]?.score ?? 0,
              marketPerformance: score.components[3]?.score ?? 0,
              fundamentals: score.components[4]?.score ?? 0,
              total: score.totalScore,
              rating: score.ratingLabel,
              confidence: score.confidencePercent,
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
