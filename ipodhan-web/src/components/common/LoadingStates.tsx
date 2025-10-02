import React from 'react';

/**
 * IPO Card Skeleton
 * Loading skeleton for IPO card component
 */
export const IPOCardSkeleton: React.FC = () => {
  return (
    <div
      className="bg-white rounded-lg shadow-md p-6 border border-gray-200 animate-pulse"
      role="status"
      aria-label="Loading IPO card"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
        <div className="h-12 w-20 bg-gray-200 rounded-lg"></div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="h-4 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded"></div>
      </div>

      {/* Price info */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="h-4 bg-gray-200 rounded"></div>
        <div className="h-4 bg-gray-200 rounded"></div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <div className="h-10 bg-gray-200 rounded flex-1"></div>
        <div className="h-10 bg-gray-200 rounded flex-1"></div>
      </div>
    </div>
  );
};

/**
 * IPO List Skeleton
 * Loading skeleton for IPO list
 */
export const IPOListSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" role="status">
      {Array.from({ length: count }).map((_, index) => (
        <IPOCardSkeleton key={index} />
      ))}
    </div>
  );
};

/**
 * Detail Page Skeleton
 * Loading skeleton for IPO detail page
 */
export const DetailPageSkeleton: React.FC = () => {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading IPO details">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="h-8 bg-gray-200 rounded w-1/2 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
          <div className="h-24 w-32 bg-gray-200 rounded-lg"></div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-200 rounded w-24"></div>
        ))}
      </div>

      {/* Content */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="space-y-4">
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          <div className="h-4 bg-gray-200 rounded w-4/5"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    </div>
  );
};

/**
 * Spinner Component
 * Generic loading spinner
 */
export const Spinner: React.FC<{ size?: 'sm' | 'md' | 'lg'; className?: string }> = ({
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-3',
    lg: 'h-12 w-12 border-4',
  };

  return (
    <div
      className={`${sizeClasses[size]} border-primary-600 border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

/**
 * Loading Overlay
 * Full-screen loading overlay
 */
export const LoadingOverlay: React.FC<{ message?: string }> = ({
  message = 'Loading...',
}) => {
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      role="status"
      aria-label={message}
    >
      <div className="bg-white rounded-lg p-6 flex flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-gray-700 font-medium">{message}</p>
      </div>
    </div>
  );
};
