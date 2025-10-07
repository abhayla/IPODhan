/**
 * IPO Not Found Page
 *
 * Displayed when an invalid IPO slug is accessed
 * Provides user-friendly message and navigation options
 *
 * @route /ipos/[slug]/not-found
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileQuestion, ArrowLeft } from 'lucide-react';

/**
 * 404 Not Found Component
 * Shown when IPO slug doesn't exist in database
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-12 w-12 text-muted-foreground" />
        </div>

        {/* Heading */}
        <h1 className="mb-3 text-4xl font-bold text-foreground">
          IPO Not Found
        </h1>

        {/* Description */}
        <p className="mb-8 text-lg text-muted-foreground">
          The IPO you&apos;re looking for doesn&apos;t exist or has been removed.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Browse All IPOs
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/">Go to Homepage</Link>
          </Button>
        </div>

        {/* Additional Help Text */}
        <p className="mt-8 text-sm text-muted-foreground">
          If you believe this is an error, please{' '}
          <Link
            href="/contact"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            contact support
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
