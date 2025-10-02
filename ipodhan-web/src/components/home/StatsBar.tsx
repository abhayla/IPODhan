import React from 'react';

export interface StatsBarProps {
  totalIPOsThisYear: number;
  averageListingGain: number;
  topPerformingIPO: string;
  currentGMPLeader: string;
}

/**
 * StatsBar Component
 * Displays quick stats about IPOs
 */
export const StatsBar: React.FC<StatsBarProps> = ({
  totalIPOsThisYear,
  averageListingGain,
  topPerformingIPO,
  currentGMPLeader,
}) => {
  const stats = [
    {
      label: 'Total IPOs This Year',
      value: totalIPOsThisYear.toString(),
      icon: '📊',
    },
    {
      label: 'Avg. Listing Gain',
      value: `${averageListingGain > 0 ? '+' : ''}${averageListingGain.toFixed(1)}%`,
      icon: '📈',
      color:
        averageListingGain > 0 ? 'text-success' : averageListingGain < 0 ? 'text-danger' : '',
    },
    {
      label: 'Top Performing IPO',
      value: topPerformingIPO,
      icon: '🏆',
    },
    {
      label: 'Current GMP Leader',
      value: currentGMPLeader,
      icon: '⭐',
    },
  ];

  return (
    <div
      className="bg-white border-y border-gray-200 py-6"
      role="region"
      aria-label="Quick statistics"
    >
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <div
              key={index}
              className="text-center p-4 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-2xl mb-2" aria-hidden="true">
                {stat.icon}
              </div>
              <p className="text-gray-500 text-xs mb-1">{stat.label}</p>
              <p className={`font-bold text-lg ${stat.color || 'text-gray-900'}`}>{stat.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
