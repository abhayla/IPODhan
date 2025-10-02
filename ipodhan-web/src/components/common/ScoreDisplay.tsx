import React from 'react';

export interface ScoreDisplayProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

/**
 * Get color classes based on score value
 */
const getScoreColors = (score: number) => {
  if (score >= 70) {
    return {
      text: 'text-success',
      bg: 'bg-success-light',
      border: 'border-success',
    };
  } else if (score >= 50) {
    return {
      text: 'text-primary-600',
      bg: 'bg-primary-50',
      border: 'border-primary-500',
    };
  } else if (score >= 30) {
    return {
      text: 'text-warning',
      bg: 'bg-warning-light',
      border: 'border-warning',
    };
  } else {
    return {
      text: 'text-danger',
      bg: 'bg-danger-light',
      border: 'border-danger',
    };
  }
};

/**
 * ScoreDisplay Component
 * Displays IPO score with color coding based on score value
 */
export const ScoreDisplay: React.FC<ScoreDisplayProps> = ({
  score,
  size = 'md',
  showLabel = false,
  trend,
  className = '',
}) => {
  const colors = getScoreColors(score);

  const sizeClasses = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '→',
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div
        className={`${colors.bg} ${colors.border} border-2 rounded-lg px-3 py-1 font-bold ${colors.text} ${sizeClasses[size]}`}
        role="img"
        aria-label={`Score: ${score} out of 100`}
      >
        {score}
        <span className="text-sm font-normal opacity-70">/100</span>
      </div>
      {trend && (
        <span
          className={`${colors.text} text-xl font-bold`}
          aria-label={`Trend: ${trend}`}
        >
          {trendIcons[trend]}
        </span>
      )}
      {showLabel && (
        <span className="text-gray-600 text-sm font-medium">IPO Score</span>
      )}
    </div>
  );
};
