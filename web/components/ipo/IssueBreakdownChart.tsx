/**
 * IssueBreakdownChart Component (Story 4.11)
 *
 * Displays a pie chart visualization of Fresh Issue vs OFS breakdown
 * with tooltips and percentages.
 */

'use client';

import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface IssueBreakdownChartProps {
  freshIssue: number | null | undefined;
  ofsIssue: number | null | undefined;
  className?: string;
}

const COLORS = {
  freshIssue: '#3B82F6', // Blue
  ofsIssue: '#10B981', // Green
};

export function IssueBreakdownChart({
  freshIssue,
  ofsIssue,
  className = '',
}: IssueBreakdownChartProps) {
  // Parse numeric values
  const freshValue = freshIssue ? parseFloat(freshIssue.toString()) : 0;
  const ofsValue = ofsIssue ? parseFloat(ofsIssue.toString()) : 0;
  const totalValue = freshValue + ofsValue;

  // If no data available
  if (totalValue === 0) {
    return (
      <div
        className={`flex items-center justify-center h-64 bg-gray-50 rounded-lg ${className}`}
      >
        <p className="text-gray-500 text-sm">No issue breakdown data available</p>
      </div>
    );
  }

  // Prepare chart data
  const data = [
    {
      name: 'Fresh Issue',
      value: freshValue,
      percentage: ((freshValue / totalValue) * 100).toFixed(1),
    },
    {
      name: 'Offer for Sale (OFS)',
      value: ofsValue,
      percentage: ((ofsValue / totalValue) * 100).toFixed(1),
    },
  ].filter((item) => item.value > 0); // Only show non-zero values

  // Custom label renderer to show percentages
  const renderLabel = (entry: { name: string; percentage: string }) => {
    return `${entry.percentage}%`;
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-800">{data.name}</p>
          <p className="text-sm text-gray-600">
            ₹{data.value.toFixed(2)} Cr ({data.payload.percentage}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderLabel}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={
                  entry.name === 'Fresh Issue'
                    ? COLORS.freshIssue
                    : COLORS.ofsIssue
                }
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value: string) => (
              <span className="text-sm text-gray-700">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Breakdown summary */}
      <div className="mt-4 space-y-2">
        {freshValue > 0 && (
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: COLORS.freshIssue }}
              />
              <span className="text-sm text-gray-700">Fresh Issue</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              ₹{freshValue.toFixed(2)} Cr
            </span>
          </div>
        )}
        {ofsValue > 0 && (
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: COLORS.ofsIssue }}
              />
              <span className="text-sm text-gray-700">Offer for Sale (OFS)</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">
              ₹{ofsValue.toFixed(2)} Cr
            </span>
          </div>
        )}
        <div className="pt-2 border-t border-gray-200 flex justify-between items-center">
          <span className="text-sm font-semibold text-gray-900">Total Issue Size</span>
          <span className="text-sm font-bold text-gray-900">
            ₹{totalValue.toFixed(2)} Cr
          </span>
        </div>
      </div>
    </div>
  );
}
