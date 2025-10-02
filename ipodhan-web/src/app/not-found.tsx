import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/common';

/**
 * 404 Not Found Page
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-8xl font-bold text-primary-600 mb-4">404</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Page Not Found</h1>
        <p className="text-gray-600 mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/">
            <Button variant="primary">Back to Home</Button>
          </Link>
          <Link href="/search">
            <Button variant="outline">Search IPOs</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
