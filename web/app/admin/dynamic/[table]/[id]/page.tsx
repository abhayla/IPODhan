/**
 * Dynamic Admin Page - Self-Extending Admin System
 *
 * This page can handle CRUD operations for ANY table in the database.
 * It introspects the schema at runtime and generates the appropriate UI.
 *
 * Routes:
 * - /admin/dynamic/[table]/new - Create new record
 * - /admin/dynamic/[table]/[id] - Edit existing record
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { DynamicFormGenerator } from '@/components/admin/DynamicFormGenerator';
import { getTableMetadata, getAllTables } from '@/lib/admin/schema-introspector';
import type { TableMetadata } from '@/lib/admin/schema-introspector';
import { adminGet, adminPost, adminPatch, adminDelete } from '@/lib/admin/admin-api-client';

export default function DynamicAdminPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated } = useAdminAuth();

  const tableName = params.table as string;
  const recordId = params.id as string;
  const isCreateMode = recordId === 'new';

  const [tableMetadata, setTableMetadata] = useState<TableMetadata | null>(null);
  const [recordData, setRecordData] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableTables, setAvailableTables] = useState<string[]>([]);

  // Load table metadata
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        // Get all available tables for navigation
        const allTables = getAllTables();
        setAvailableTables(Object.keys(allTables).sort());

        // Get metadata for current table
        const metadata = getTableMetadata(tableName);
        if (!metadata) {
          throw new Error(`Table "${tableName}" not found in schema`);
        }
        setTableMetadata(metadata);
      } catch (err) {
        console.error('Failed to load table metadata:', err);
        setError(err instanceof Error ? err.message : 'Failed to load table metadata');
      }
    };

    loadMetadata();
  }, [tableName]);

  // Load record data if editing
  useEffect(() => {
    const loadRecord = async () => {
      if (isCreateMode || !tableMetadata) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const response = await adminGet(`/api/admin/dynamic/${tableName}/${recordId}`);

        if (response.success && response.data) {
          setRecordData(response.data);
        } else {
          throw new Error(response.error || 'Failed to load record');
        }
      } catch (err) {
        console.error('Failed to load record:', err);
        setError(err instanceof Error ? err.message : 'Failed to load record');
      } finally {
        setIsLoading(false);
      }
    };

    loadRecord();
  }, [tableName, recordId, isCreateMode, tableMetadata]);

  // Handle form submission
  const handleSubmit = async (data: Record<string, any>) => {
    try {
      let response;

      if (isCreateMode) {
        // Create new record
        response = await adminPost(`/api/admin/dynamic/${tableName}`, data);
      } else {
        // Update existing record
        response = await adminPatch(`/api/admin/dynamic/${tableName}/${recordId}`, data);
      }

      if (response.success) {
        // Show success message
        alert(`Record ${isCreateMode ? 'created' : 'updated'} successfully!`);

        // If created, redirect to edit page
        if (isCreateMode && response.data?.id) {
          router.push(`/admin/dynamic/${tableName}/${response.data.id}`);
        } else {
          // Reload data to show updated values
          window.location.reload();
        }
      } else {
        throw new Error(response.error || 'Operation failed');
      }
    } catch (err) {
      console.error('Form submission error:', err);
      alert(err instanceof Error ? err.message : 'Failed to save record');
    }
  };

  // Handle record deletion
  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await adminDelete(`/api/admin/dynamic/${tableName}/${recordId}`);

      if (response.success) {
        alert('Record deleted successfully!');
        router.push(`/admin/dynamic/${tableName}/list`);
      } else {
        throw new Error(response.error || 'Failed to delete record');
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert(err instanceof Error ? err.message : 'Failed to delete record');
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

  if (isLoading || !tableMetadata) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-300 rounded w-1/3 mb-4"></div>
            <div className="space-y-3">
              <div className="h-4 bg-gray-300 rounded w-full"></div>
              <div className="h-4 bg-gray-300 rounded w-5/6"></div>
              <div className="h-4 bg-gray-300 rounded w-4/6"></div>
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
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Dynamic Admin System
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Self-extending form generation from database schema
              </p>
            </div>
            <Link
              href="/admin"
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
            >
              Back to Admin
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Sidebar - Table Navigation */}
          <aside className="w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Available Tables</h3>
              <nav className="space-y-1">
                {availableTables.map(table => (
                  <Link
                    key={table}
                    href={`/admin/dynamic/${table}/list`}
                    className={`block px-3 py-2 rounded-md text-sm ${
                      table === tableName
                        ? 'bg-blue-100 text-blue-900 font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {table.replace(/([A-Z])/g, ' $1').trim()}
                  </Link>
                ))}
              </nav>

              {/* Quick Actions */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Quick Actions</h4>
                <div className="space-y-2">
                  <Link
                    href={`/admin/dynamic/${tableName}/list`}
                    className="block px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
                  >
                    View All Records
                  </Link>
                  <Link
                    href={`/admin/dynamic/${tableName}/new`}
                    className="block px-3 py-2 text-sm text-green-600 hover:bg-green-50 rounded-md"
                  >
                    Create New Record
                  </Link>
                </div>
              </div>

              {/* Table Info */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="text-sm font-semibold text-gray-900 mb-2">Table Info</h4>
                <dl className="text-xs space-y-1">
                  <div>
                    <dt className="text-gray-500">Total Columns:</dt>
                    <dd className="font-medium text-gray-900">{tableMetadata.columns.length}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Primary Key:</dt>
                    <dd className="font-medium text-gray-900">{tableMetadata.primaryKey || 'None'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Relations:</dt>
                    <dd className="font-medium text-gray-900">{tableMetadata.relations.length}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </aside>

          {/* Main Content - Dynamic Form */}
          <main className="flex-1">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6">
                {/* Page Title */}
                <div className="mb-6 flex justify-between items-center">
                  <h2 className="text-xl font-bold text-gray-900">
                    {isCreateMode ? 'Create New' : 'Edit'} {tableName.replace(/([A-Z])/g, ' $1').trim()}
                  </h2>
                  {!isCreateMode && (
                    <button
                      onClick={handleDelete}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      Delete Record
                    </button>
                  )}
                </div>

                {/* Record ID Display */}
                {!isCreateMode && recordId && (
                  <div className="mb-4 bg-gray-50 rounded-lg p-3">
                    <span className="text-sm text-gray-600">Record ID: </span>
                    <span className="font-mono text-sm font-medium text-gray-900">{recordId}</span>
                  </div>
                )}

                {/* Dynamic Form */}
                <DynamicFormGenerator
                  tableMetadata={tableMetadata}
                  initialData={recordData || {}}
                  onSubmit={handleSubmit}
                  onCancel={() => router.back()}
                  mode={isCreateMode ? 'create' : 'edit'}
                />
              </div>
            </div>

            {/* Help Section */}
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
              <h3 className="text-lg font-semibold text-blue-900">
                Self-Extending Admin System
              </h3>
              <p className="text-sm text-blue-700 mt-2">
                This form is automatically generated from the database schema. Any changes to the
                schema will be reflected here without code modifications.
              </p>
              <ul className="mt-3 space-y-1 text-sm text-blue-700">
                <li>• Fields marked with * are required</li>
                <li>• Date fields use the format YYYY-MM-DD</li>
                <li>• JSON fields accept valid JSON objects</li>
                <li>• Enum fields show available options in dropdowns</li>
                <li>• System fields (id, createdAt, updatedAt) are read-only</li>
              </ul>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}