/**
 * IPO Objectives Editor - Dynamic Admin Route
 *
 * Specialized route for editing IPO objectives (objects of the issue).
 * Part of Phase 1 Admin Consolidation.
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { adminGet, adminPatch } from '@/lib/admin/admin-api-client';
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

interface ObjectivesEditorProps {
  objectives: IPOObjective[];
  onSave: (objectives: IPOObjective[]) => Promise<void>;
  isSaving: boolean;
}

/**
 * Objectives Editor Component
 * Allows admin to add, edit, and delete IPO objectives
 */
function ObjectivesEditor({ objectives, onSave, isSaving }: ObjectivesEditorProps) {
  const [editedObjectives, setEditedObjectives] = useState<IPOObjective[]>(objectives);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setEditedObjectives(objectives);
    setHasChanges(false);
  }, [objectives]);

  const handleAddObjective = () => {
    const newSno = editedObjectives.length > 0
      ? Math.max(...editedObjectives.map(obj => obj.sno)) + 1
      : 1;

    setEditedObjectives([
      ...editedObjectives,
      { sno: newSno, description: '', amount: null }
    ]);
    setHasChanges(true);
  };

  const handleUpdateObjective = (index: number, field: keyof IPOObjective, value: any) => {
    const updated = [...editedObjectives];
    if (field === 'amount') {
      updated[index][field] = value === '' || value === null ? null : Number(value);
    } else {
      updated[index][field] = value as never;
    }
    setEditedObjectives(updated);
    setHasChanges(true);
  };

  const handleDeleteObjective = (index: number) => {
    const updated = editedObjectives.filter((_, i) => i !== index);
    // Re-number objectives
    const renumbered = updated.map((obj, i) => ({ ...obj, sno: i + 1 }));
    setEditedObjectives(renumbered);
    setHasChanges(true);
  };

  const handleSave = async () => {
    // Validate objectives
    const invalidObjectives = editedObjectives.filter(
      obj => !obj.description.trim() || obj.sno < 1
    );

    if (invalidObjectives.length > 0) {
      alert('All objectives must have a description and valid serial number');
      return;
    }

    await onSave(editedObjectives);
    setHasChanges(false);
  };

  const handleReset = () => {
    setEditedObjectives(objectives);
    setHasChanges(false);
  };

  const totalAllocated = editedObjectives
    .filter(obj => obj.amount !== null)
    .reduce((sum, obj) => sum + (obj.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* Objectives List */}
      {editedObjectives.length > 0 ? (
        <div className="space-y-3">
          {editedObjectives.map((objective, index) => (
            <div key={index} className="p-4 bg-white border border-gray-300 rounded-lg hover:border-gray-400 transition-colors">
              <div className="grid grid-cols-12 gap-4 items-start">
                {/* S.No */}
                <div className="col-span-1">
                  <label className="block text-xs font-medium text-gray-700 mb-2">S.No</label>
                  <input
                    type="number"
                    value={objective.sno}
                    onChange={(e) => handleUpdateObjective(index, 'sno', parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1"
                  />
                </div>

                {/* Description */}
                <div className="col-span-7">
                  <label className="block text-xs font-medium text-gray-700 mb-2">Description</label>
                  <input
                    type="text"
                    value={objective.description}
                    onChange={(e) => handleUpdateObjective(index, 'description', e.target.value)}
                    placeholder="e.g., Repayment of debt, Working capital requirements"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Amount */}
                <div className="col-span-3">
                  <label className="block text-xs font-medium text-gray-700 mb-2">Amount (₹ Cr)</label>
                  <input
                    type="number"
                    value={objective.amount ?? ''}
                    onChange={(e) => handleUpdateObjective(index, 'amount', e.target.value)}
                    placeholder="Optional"
                    step="0.01"
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Delete Button */}
                <div className="col-span-1 flex items-end">
                  <button
                    onClick={() => handleDeleteObjective(index)}
                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                    title="Delete objective"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm">No objectives defined yet.</p>
          <p className="text-xs mt-1">Click "Add Objective" to start defining fund utilization</p>
        </div>
      )}

      {/* Total Display */}
      {editedObjectives.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-gray-700">Total Allocated:</span>
            <span className="text-lg font-bold text-blue-600">₹{totalAllocated.toFixed(2)} Cr</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        <button
          onClick={handleAddObjective}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          + Add Objective
        </button>

        {hasChanges && (
          <>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>

            <button
              onClick={handleReset}
              disabled={isSaving}
              className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-700 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>
          </>
        )}

        <div className="ml-auto text-sm text-gray-500">
          {hasChanges && '• Unsaved changes'}
        </div>
      </div>
    </div>
  );
}

export default function IPOObjectivesPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAdminAuth();

  const ipoId = params.id as string;

  const [ipo, setIpo] = useState<IPO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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

  const handleSaveObjectives = async (objectives: IPOObjective[]) => {
    try {
      setIsSaving(true);

      const response = await adminPatch(`/api/admin/dynamic/ipos/${ipoId}`, {
        objectives
      });

      if (response.success) {
        alert('Objectives saved successfully!');
        // Reload to show updated data
        await loadIPO();
      } else {
        throw new Error(response.error || 'Failed to save objectives');
      }
    } catch (err) {
      console.error('Failed to save objectives:', err);
      alert(err instanceof Error ? err.message : 'Failed to save objectives');
    } finally {
      setIsSaving(false);
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
                Edit IPO Objectives
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Define objects of the issue and fund utilization
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

        {/* Objectives Editor */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900">Objects of the Issue</h2>
            <p className="text-sm text-gray-600 mt-1">
              Define how the funds raised from this IPO will be utilized
            </p>
          </div>

          <ObjectivesEditor
            objectives={ipo.objectives || []}
            onSave={handleSaveObjectives}
            isSaving={isSaving}
          />
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900">
            About IPO Objectives
          </h3>
          <p className="text-sm text-blue-700 mt-2">
            IPO objectives define how the company intends to use the funds raised from the public offering.
            Common objectives include debt repayment, working capital, expansion, acquisitions, etc.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-blue-700">
            <li>• Each objective should have a clear description</li>
            <li>• Amounts are optional but recommended for transparency</li>
            <li>• Serial numbers determine display order on the website</li>
            <li>• Changes are saved immediately upon clicking "Save Changes"</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
