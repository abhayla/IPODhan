/**
 * IPO Objectives — Dynamic Admin Route (READ-ONLY, §9.4)
 *
 * §9.4: there is one place an admin value is written — the IPO-page editor (OD-102).
 * This route shows the current objectives for reference; it does not save anything.
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { adminGet } from '@/lib/admin/admin-api-client';
import { Breadcrumb } from '@/components/admin/Breadcrumb';

interface IPO {
  id: string;
  companyName: string;
  slug: string;
  status: string;
  objectives: IPOObjective[];
}

interface IPOObjective {
  sno: number;
  description: string;
  amount: number | null;
}

export default function IPOObjectivesPage() {
  const params = useParams();
  const { isAuthenticated } = useAdminAuth();

  const ipoId = params.id as string;

  const [ipo, setIpo] = useState<IPO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadIPO();
  }, [ipoId]);

  const loadIPO = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await adminGet(`/api/admin/dynamic/ipos/${ipoId}`);

      if (response.success && response.data) {
        setIpo(response.data);
      } else {
        throw new Error(response.error || 'Failed to load IPO');
      }
    } catch (err) {
      console.error('Failed to load IPO:', err);
      setError(err instanceof Error ? err.message : 'Failed to load IPO');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Authentication Required</h1>
          <p className="mt-2 text-gray-600">Please log in to access the admin panel.</p>
          <Link href="/admin" className="mt-4 inline-block text-blue-600 hover:underline">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-red-900">Error</h2>
            <p className="text-red-700 mt-1">{error}</p>
            <Link
              href="/admin"
              className="mt-4 inline-block text-red-600 hover:underline"
            >
              Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading || !ipo) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-4 bg-gray-300 rounded w-full"></div>
              <div className="h-4 bg-gray-300 rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const objectives: IPOObjective[] = ipo.objectives || [];
  const totalAllocated = objectives
    .filter((obj) => obj.amount !== null)
    .reduce((sum, obj) => sum + (obj.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Breadcrumb Navigation */}
          <div className="mb-4">
            <Breadcrumb />
          </div>

          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                IPO Objectives
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Objects of the issue and fund utilization
              </p>
            </div>
            <div className="flex gap-3">
              <Link
                href={`/admin/dynamic/ipos/${ipoId}`}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Back to IPO
              </Link>
              <Link
                href="/admin"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Admin Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Read-only notice (§9.4): values are written only on the IPO page editor */}
        <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
          <h3 className="text-sm font-medium text-yellow-800">Read-only screen</h3>
          <p className="mt-1 text-sm text-yellow-700">
            Values are now edited on the{' '}
            <Link href={`/ipos/${ipo.slug}`} className="font-semibold underline hover:text-yellow-900">
              IPO page
            </Link>{' '}
            (Edit control, admin only). This screen is read-only.
          </p>
        </div>

        {/* IPO Context Banner */}
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-blue-900">{ipo.companyName}</h3>
              <div className="flex items-center gap-4 mt-1 text-sm text-blue-700">
                <span>ID: <span className="font-mono">{ipo.id}</span></span>
                <span>•</span>
                <span>Slug: <span className="font-mono">{ipo.slug}</span></span>
                <span>•</span>
                <span>Status: <span className="font-semibold">{ipo.status}</span></span>
              </div>
            </div>
            <Link
              href={`/admin/dynamic/ipos/${ipoId}`}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              View Full Record →
            </Link>
          </div>
        </div>

        {/* Objectives (read-only) */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Objects of the Issue</h2>
            <p className="text-sm text-gray-600 mt-1">
              How the funds raised from this IPO will be utilized
            </p>
          </div>

          {objectives.length > 0 ? (
            <div className="space-y-3">
              {objectives.map((objective) => (
                <div key={objective.sno} className="p-4 bg-white border border-gray-300 rounded-lg">
                  <div className="grid grid-cols-12 gap-4 items-start">
                    <div className="col-span-1 text-sm text-gray-700">#{objective.sno}</div>
                    <div className="col-span-8 text-sm text-gray-900">{objective.description}</div>
                    <div className="col-span-3 text-sm text-gray-900">
                      {objective.amount !== null ? `₹${objective.amount.toFixed(2)} Cr` : 'General Corporate Purposes'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-sm">No objectives defined yet.</p>
            </div>
          )}

          {objectives.length > 0 && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700">Total Allocated:</span>
                <span className="text-lg font-bold text-blue-600">₹{totalAllocated.toFixed(2)} Cr</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
