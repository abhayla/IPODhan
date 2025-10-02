import React from 'react';
import type { TabType } from '@/types/ipo';

export interface IPOTabsProps {
  tabs: TabType[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/**
 * IPOTabs Component
 * Tab navigation for Live, Upcoming, and Closed IPOs
 */
export const IPOTabs: React.FC<IPOTabsProps> = ({ tabs, activeTab, onTabChange }) => {
  return (
    <div className="border-b border-gray-200 bg-white" role="tablist" aria-label="IPO categories">
      <div className="max-w-7xl mx-auto px-4">
        <nav className="flex gap-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              className={`relative py-4 px-2 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-primary-600 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => onTabChange(tab.id)}
            >
              <span className="flex items-center gap-2">
                {tab.label}
                <span
                  className={`inline-flex items-center justify-center min-w-[24px] h-6 px-2 text-xs font-semibold rounded-full ${
                    activeTab === tab.id
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              </span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
};
