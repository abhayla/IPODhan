/**
 * IPO Context Banner Component
 *
 * Displays IPO context information at the top of admin pages
 * for better orientation when editing IPO-related data.
 *
 * Part of Phase 2: Navigation & UX Enhancements
 */

'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

interface IPOContextBannerProps {
  ipoId: string;
  companyName?: string;
  slug?: string;
  status?: string;
  currentPage?: string;
}

interface IPOData {
  id: string;
  companyName: string;
  slug: string;
  status: string;
  segment: string | null;
  openDate: string | null;
  closeDate: string | null;
}

export function IPOContextBanner({
  ipoId,
  companyName,
  slug,
  status,
  currentPage
}: IPOContextBannerProps) {
  const [ipoData, setIpoData] = useState<IPOData | null>(null);
  const [isLoading, setIsLoading] = useState(!companyName);

  useEffect(() => {
    // If we don't have company name, fetch IPO data
    if (!companyName && ipoId) {
      fetchIPOData();
    } else if (companyName) {
      setIpoData({
        id: ipoId,
        companyName,
        slug: slug || '',
        status: status || 'UNKNOWN',
        segment: null,
        openDate: null,
        closeDate: null
      });
      setIsLoading(false);
    }
  }, [ipoId, companyName, slug, status]);

  const fetchIPOData = async () => {
    try {
      const response = await fetch(`/api/admin/dynamic/ipos/${ipoId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          setIpoData(data.data);
        }
      }
    } catch (err) {
      console.error('Failed to fetch IPO data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-blue-200 rounded w-1/3 mb-2"></div>
        <div className="h-4 bg-blue-100 rounded w-1/2"></div>
      </div>
    );
  }

  if (!ipoData) {
    return null;
  }

  const statusColors: Record<string, string> = {
    UPCOMING: 'bg-purple-100 text-purple-800',
    OPEN: 'bg-green-100 text-green-800',
    CLOSED: 'bg-orange-100 text-orange-800',
    LISTED: 'bg-blue-100 text-blue-800',
    CANCELLED: 'bg-red-100 text-red-800',
    WITHDRAWN: 'bg-gray-100 text-gray-800'
  };

  const statusColor = statusColors[ipoData.status] || 'bg-gray-100 text-gray-800';

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-blue-900">
              {ipoData.companyName}
            </h3>
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
              {ipoData.status}
            </span>
            {ipoData.segment && (
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                {ipoData.segment}
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-2 text-sm text-blue-700">
            <span>
              ID: <span className="font-mono">{ipoData.id.substring(0, 8)}...</span>
            </span>
            <span>•</span>
            <span>
              Slug: <span className="font-mono">{ipoData.slug}</span>
            </span>
            {ipoData.openDate && (
              <>
                <span>•</span>
                <span>
                  Open: {new Date(ipoData.openDate).toLocaleDateString('en-IN')}
                </span>
              </>
            )}
            {ipoData.closeDate && (
              <>
                <span>•</span>
                <span>
                  Close: {new Date(ipoData.closeDate).toLocaleDateString('en-IN')}
                </span>
              </>
            )}
          </div>

          {currentPage && (
            <div className="mt-2 text-xs text-blue-600">
              Currently editing: <span className="font-semibold">{currentPage}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Link
            href={`/admin/dynamic/ipos/${ipoData.id}`}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            View IPO
          </Link>
          <Link
            href={`/ipos/${ipoData.slug}`}
            target="_blank"
            className="px-3 py-1.5 text-sm bg-white text-blue-600 border border-blue-600 rounded hover:bg-blue-50 transition-colors"
          >
            Preview ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
