/**
 * Admin Panel - Review Moderation (Story 11.16)
 *
 * Approve or reject broker reviews before they appear on IPO detail pages
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminGet, adminPatch } from '@/lib/admin/admin-api-client';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { HiCheck, HiXMark, HiExclamationCircle, HiArrowPath, HiChatBubbleLeftRight, HiCalendar, HiUser } from 'react-icons/hi2';
import { useToast } from '@/hooks/useToast';
import type { IPOReview } from '@/lib/db/types';

// ==================== TYPES ====================

interface PendingReviewsResponse {
  success: boolean;
  data: IPOReview[];
  meta: {
    count: number;
    timestamp: string;
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get badge variant based on recommendation type
 */
function getRecommendationVariant(
  recommendation: string
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (recommendation) {
    case 'May apply':
    case 'Subscribe':
      return 'default';
    case 'Avoid':
    case 'Not Recommended':
      return 'destructive';
    default:
      return 'secondary';
  }
}

/**
 * Format date to readable string
 */
function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ==================== REVIEW CARD COMPONENT ====================

interface ReviewCardProps {
  review: IPOReview;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isProcessing: boolean;
}

function ReviewCard({ review, onApprove, onReject, isProcessing }: ReviewCardProps) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-lg leading-tight flex-1">{review.reviewTitle}</CardTitle>
          <Badge variant={getRecommendationVariant(review.recommendation)}>
            {review.recommendation}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <HiUser className="h-4 w-4" />
            {review.author}
          </div>
          <div className="flex items-center gap-1.5">
            <HiCalendar className="h-4 w-4" />
            {formatDate(review.publishedDate)}
          </div>
          <Badge variant="outline" className="text-xs">
            {review.segment}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-3">
          {review.reviewContent
            ? review.reviewContent.length > 200
              ? `${review.reviewContent.substring(0, 200)}...`
              : review.reviewContent
            : 'No content preview available'}
        </p>
        {review.reviewUrl && (
          <a
            href={review.reviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            View original review →
          </a>
        )}
      </CardContent>
      <CardFooter className="flex gap-2 border-t pt-4">
        <Button
          onClick={() => onApprove(review.id)}
          disabled={isProcessing}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          size="sm"
        >
          {isProcessing ? (
            <HiArrowPath className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <HiCheck className="h-4 w-4 mr-2" />
          )}
          Approve
        </Button>
        <Button
          onClick={() => onReject(review.id)}
          disabled={isProcessing}
          variant="destructive"
          size="sm"
          className="flex-1"
        >
          {isProcessing ? (
            <HiArrowPath className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <HiXMark className="h-4 w-4 mr-2" />
          )}
          Reject
        </Button>
      </CardFooter>
    </Card>
  );
}

// ==================== SKELETON LOADER ====================

function SkeletonCard() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="h-6 bg-muted rounded w-2/3 animate-pulse" />
          <div className="h-6 bg-muted rounded w-20 animate-pulse" />
        </div>
        <div className="flex gap-3 mt-2">
          <div className="h-4 bg-muted rounded w-24 animate-pulse" />
          <div className="h-4 bg-muted rounded w-24 animate-pulse" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="h-4 bg-muted rounded w-full animate-pulse" />
          <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
          <div className="h-4 bg-muted rounded w-4/6 animate-pulse" />
        </div>
      </CardContent>
      <CardFooter className="flex gap-2 border-t pt-4">
        <div className="h-9 bg-muted rounded flex-1 animate-pulse" />
        <div className="h-9 bg-muted rounded flex-1 animate-pulse" />
      </CardFooter>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export default function ReviewModerationPage() {
  const { toast } = useToast();

  // State
  const [pendingReviews, setPendingReviews] = useState<IPOReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [errorMessage, setErrorMessage] = useState('');

  // ==================== API FUNCTIONS ====================

  /**
   * Fetch all pending reviews (isApproved = false)
   */
  const fetchPendingReviews = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage('');

      const response = (await adminGet('/api/admin/reviews')) as PendingReviewsResponse;

      if (response.success) {
        setPendingReviews(response.data);
      } else {
        throw new Error('Failed to fetch reviews');
      }
    } catch (error) {
      console.error('Failed to fetch pending reviews:', error);
      const message = error instanceof Error ? error.message : 'Failed to load pending reviews';
      setErrorMessage(message);
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Fetch pending reviews on mount
  useEffect(() => {
    fetchPendingReviews();
  }, [fetchPendingReviews]);

  /**
   * Approve a review
   */
  const handleApprove = async (reviewId: string) => {
    setProcessingIds((prev) => new Set(prev).add(reviewId));

    try {
      const response = await adminPatch(`/api/admin/reviews/${reviewId}`, {
        action: 'approve',
      });

      if (response.success) {
        // Remove from pending list
        setPendingReviews((prev) => prev.filter((r) => r.id !== reviewId));

        toast({
          title: 'Success',
          description: 'Review approved successfully',
        });
      } else {
        throw new Error('Failed to approve review');
      }
    } catch (error) {
      console.error('Failed to approve review:', error);
      const message = error instanceof Error ? error.message : 'Failed to approve review';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  };

  /**
   * Reject a review
   */
  const handleReject = async (reviewId: string) => {
    setProcessingIds((prev) => new Set(prev).add(reviewId));

    try {
      const response = await adminPatch(`/api/admin/reviews/${reviewId}`, {
        action: 'reject',
      });

      if (response.success) {
        // Remove from pending list
        setPendingReviews((prev) => prev.filter((r) => r.id !== reviewId));

        toast({
          title: 'Success',
          description: 'Review rejected successfully',
        });
      } else {
        throw new Error('Failed to reject review');
      }
    } catch (error) {
      console.error('Failed to reject review:', error);
      const message = error instanceof Error ? error.message : 'Failed to reject review';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(reviewId);
        return next;
      });
    }
  };

  // ==================== RENDER ====================

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
              <HiChatBubbleLeftRight className="h-8 w-8 text-primary" />
              Review Moderation
            </h1>
            <p className="text-muted-foreground">
              Approve or reject broker reviews before they appear on IPO detail pages
            </p>
          </div>
          {!loading && (
            <Badge variant="secondary" className="text-base px-4 py-2">
              {pendingReviews.length} Pending
            </Badge>
          )}
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <Alert className="mb-6 border-red-500 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-200">
          <HiExclamationCircle className="h-4 w-4" />
          <div className="ml-2">
            <p className="font-semibold">Error</p>
            <p className="text-sm">{errorMessage}</p>
          </div>
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Empty State */}
      {!loading && pendingReviews.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-muted p-6 mb-4">
              <HiChatBubbleLeftRight className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No pending reviews</h3>
            <p className="text-muted-foreground text-center max-w-md">
              All reviews have been moderated. New submissions will appear here for approval.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Review Cards Grid */}
      {!loading && pendingReviews.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {pendingReviews.map((review) => (
            <ReviewCard
              key={review.id}
              review={review}
              onApprove={handleApprove}
              onReject={handleReject}
              isProcessing={processingIds.has(review.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
