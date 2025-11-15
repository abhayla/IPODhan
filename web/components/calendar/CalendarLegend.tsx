/**
 * Calendar Legend Component
 *
 * Comprehensive legend explaining event types, colors, and date highlights
 * used in the IPO calendar.
 *
 * Features:
 * - Event type color coding with descriptions
 * - Cell background color meanings
 * - Collapsible on mobile to save space
 * - Explanation of why IPOs appear on multiple dates
 */

'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function CalendarLegend() {
  const [isExpanded, setIsExpanded] = useState(true);

  const eventTypes = [
    {
      icon: '📝',
      label: 'IPO Opening',
      color: 'text-green-600',
      description: 'First day to apply for the IPO',
    },
    {
      icon: '🔒',
      label: 'IPO Closing',
      color: 'text-red-600',
      description: 'Last day to apply for the IPO',
    },
    {
      icon: '🎯',
      label: 'Allotment',
      color: 'text-blue-600',
      description: 'Shares allocated to investors',
    },
    {
      icon: '📊',
      label: 'Basis of Allotment',
      color: 'text-indigo-600',
      description: 'Allotment results published (check status)',
    },
    {
      icon: '💰',
      label: 'Refund Initiation',
      color: 'text-purple-600',
      description: 'Refunds processed for unsuccessful applicants',
    },
    {
      icon: '💳',
      label: 'Credit of Shares',
      color: 'text-teal-600',
      description: 'Shares credited to demat accounts',
    },
    {
      icon: '🎉',
      label: 'Listing Day',
      color: 'text-amber-600',
      description: 'Stock starts trading on exchange',
    },
    {
      icon: '🏖️',
      label: 'Market Holiday',
      color: 'text-gray-500',
      description: 'Stock exchange closed (no trading)',
    },
  ];

  const dateHighlights = [
    {
      color: 'Blue background',
      example: 'bg-blue-50',
      meaning: "Today's date",
    },
    {
      color: 'Yellow background',
      example: 'bg-yellow-50',
      meaning: 'Multiple events on same day',
    },
    {
      color: 'Gray background',
      example: 'bg-gray-50',
      meaning: 'Market holiday (no trading)',
    },
  ];

  return (
    <div className="mb-6 border border-gray-200 rounded-lg bg-white shadow-sm">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
        aria-expanded={isExpanded}
        aria-controls="calendar-legend-content"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📅</span>
          <h3 className="text-lg font-semibold text-gray-900">Calendar Legend</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 hidden sm:inline">
            {isExpanded ? 'Hide' : 'Show'} details
          </span>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-500" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div id="calendar-legend-content" className="px-4 pb-4 space-y-6">
          {/* Event Types Section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Event Types:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {eventTypes.map((event, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-lg flex-shrink-0">{event.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium ${event.color}`}>
                      {event.label}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {event.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Date Highlights Section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Date Highlights:</h4>
            <div className="space-y-2">
              {dateHighlights.map((highlight, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div
                    className={`w-16 h-8 border border-gray-200 rounded ${highlight.example} flex-shrink-0`}
                    aria-label={`Example of ${highlight.color}`}
                  />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-700">
                      {highlight.color}
                    </span>
                    <span className="text-sm text-gray-600"> - {highlight.meaning}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Explanation Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-blue-900 mb-2">
              💡 Why do IPOs appear on multiple dates?
            </h4>
            <p className="text-sm text-blue-800 leading-relaxed">
              Each IPO has multiple milestone dates throughout its lifecycle. The same IPO will
              appear on different dates with different colors based on which event is happening that
              day. For example, "ABC Corporation Ltd" might appear on Nov 2 (Open), Nov 9 (Close),
              and Nov 17 (Listing).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
