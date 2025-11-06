/**
 * DRHP Extraction UI - PDF Upload and Data Extraction Interface
 *
 * This page provides:
 * - PDF upload functionality
 * - Extraction status monitoring
 * - Extracted data review
 * - Manual correction interface
 * - Integration with extraction_logs table
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { adminGet, adminPost } from '@/lib/admin/admin-api-client';

interface ExtractionLog {
  id: string;
  ipoId: string | null;
  companyName: string;
  fileName: string;
  filePath: string | null;
  fileSize: number | null;
  totalPages: number | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  extractorVersion: string | null;
  extractionMethod: string | null;
  fieldsExtracted: number;
  totalFields: number;
  extractedData: any;
  confidenceScore: number | null;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  dataIssues: string[] | null;
  durationMs: number | null;
  plPageNumber: number | null;
  bsPageNumber: number | null;
  cashFlowPageNumber: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExtractedField {
  field: string;
  value: any;
  unit: string;
  confidence: number;
  source: string;
}

const statusColors = {
  PENDING: 'bg-gray-100 text-gray-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  SUCCESS: 'bg-green-100 text-green-800',
  PARTIAL: 'bg-yellow-100 text-yellow-800',
  FAILED: 'bg-red-100 text-red-800'
};

const confidenceColors = {
  HIGH: 'text-green-600',
  MEDIUM: 'text-yellow-600',
  LOW: 'text-red-600'
};

export default function DRHPExtractionPage() {
  const router = useRouter();
  const { isAuthenticated } = useAdminAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<'upload' | 'history' | 'review'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extractionLogs, setExtractionLogs] = useState<ExtractionLog[]>([]);
  const [selectedLog, setSelectedLog] = useState<ExtractionLog | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load extraction logs
  useEffect(() => {
    loadExtractionLogs();
  }, []);

  const loadExtractionLogs = async () => {
    try {
      setIsLoading(true);
      const response = await adminGet('/api/admin/dynamic/extractionLogs/list?sortBy=createdAt&sortOrder=desc&limit=50');

      if (response.success && response.data) {
        setExtractionLogs(response.data.records || []);
      }
    } catch (err) {
      console.error('Failed to load extraction logs:', err);
      setError('Failed to load extraction history');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        setError('Please select a PDF file');
        return;
      }
      if (file.size > 50 * 1024 * 1024) { // 50MB limit
        setError('File size must be less than 50MB');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleUploadAndExtract = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(10);
      setError(null);
      setSuccessMessage(null);

      // Create form data
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('companyName', selectedFile.name.replace('.pdf', '').replace(/_/g, ' '));

      // Upload file and trigger extraction (using adminFetch for file uploads)
      setUploadProgress(30);
      const token = localStorage.getItem('admin_token');
      const response = await fetch('/api/admin/drhp/extract', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      setUploadProgress(60);
      const result = await response.json();

      if (result.success) {
        setUploadProgress(100);
        setSuccessMessage(`Extraction completed! ${result.fieldsExtracted || 0} fields extracted.`);
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }

        // Reload extraction logs
        await loadExtractionLogs();

        // Switch to history tab to show the new extraction
        setActiveTab('history');
      } else {
        throw new Error(result.error || 'Extraction failed');
      }
    } catch (err) {
      console.error('Upload/extraction error:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload and extract PDF');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleReprocess = async (logId: string) => {
    try {
      const response = await adminPost(`/api/admin/drhp/reprocess/${logId}`, {});

      if (response.success) {
        setSuccessMessage('Reprocessing started successfully');
        await loadExtractionLogs();
      } else {
        throw new Error(response.error || 'Reprocessing failed');
      }
    } catch (err) {
      console.error('Reprocess error:', err);
      setError(err instanceof Error ? err.message : 'Failed to reprocess');
    }
  };

  const renderUploadTab = () => (
    <div className="space-y-6">
      {/* Upload Area */}
      <div className="bg-white rounded-lg shadow-sm p-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload DRHP PDF</h3>

        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center ${
            selectedFile ? 'border-blue-300 bg-blue-50' : 'border-gray-300'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileSelect}
            className="hidden"
            id="pdf-upload"
          />

          <label
            htmlFor="pdf-upload"
            className="cursor-pointer"
          >
            <div className="space-y-4">
              <div className="text-4xl">📄</div>
              {selectedFile ? (
                <>
                  <p className="text-lg font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="text-sm text-gray-600">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </>
              ) : (
                <>
                  <p className="text-lg font-medium text-gray-900">
                    Drop PDF here or click to browse
                  </p>
                  <p className="text-sm text-gray-600">
                    Maximum file size: 50MB
                  </p>
                </>
              )}
            </div>
          </label>
        </div>

        {selectedFile && (
          <div className="mt-6 flex justify-center gap-4">
            <button
              onClick={() => {
                setSelectedFile(null);
                if (fileInputRef.current) {
                  fileInputRef.current.value = '';
                }
              }}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Clear
            </button>
            <button
              onClick={handleUploadAndExtract}
              disabled={isUploading}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isUploading ? 'Processing...' : 'Extract Data'}
            </button>
          </div>
        )}

        {/* Progress Bar */}
        {isUploading && (
          <div className="mt-6">
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Processing PDF...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Extraction Methods Info */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h4 className="text-lg font-semibold text-gray-900 mb-4">Extraction Methods</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-900 mb-2">PDFPlumber v3</h5>
            <p className="text-sm text-gray-600">
              Primary extractor with lakhs/crores conversion fix.
              94.1% accuracy on financial data.
            </p>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-900 mb-2">PyMuPDF4LLM</h5>
            <p className="text-sm text-gray-600">
              Fallback extractor for complex layouts.
              Better table detection.
            </p>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <h5 className="font-medium text-gray-900 mb-2">Manual Review</h5>
            <p className="text-sm text-gray-600">
              Human verification for critical fields.
              100% accuracy guaranteed.
            </p>
          </div>
        </div>
      </div>

      {/* Extracted Fields Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h4 className="text-lg font-semibold text-blue-900 mb-3">Fields We Extract</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm text-blue-800">
          <div>✓ Revenue</div>
          <div>✓ Net Profit</div>
          <div>✓ Total Assets</div>
          <div>✓ Total Liabilities</div>
          <div>✓ EBITDA</div>
          <div>✓ EPS</div>
          <div>✓ ROE</div>
          <div>✓ Debt/Equity</div>
          <div>✓ Current Ratio</div>
          <div>✓ Operating Margin</div>
          <div>✓ Net Margin</div>
          <div>✓ Cash Flow</div>
          <div>✓ Working Capital</div>
          <div>✓ Book Value</div>
          <div>✓ P/E Ratio</div>
          <div>✓ Market Cap</div>
        </div>
      </div>
    </div>
  );

  const renderHistoryTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Extraction History</h3>
        </div>

        {isLoading ? (
          <div className="p-8 text-center">
            <div className="animate-pulse">Loading extraction history...</div>
          </div>
        ) : extractionLogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fields</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {extractionLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {log.companyName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      <div>
                        <p className="truncate max-w-xs" title={log.fileName}>
                          {log.fileName}
                        </p>
                        {log.totalPages && (
                          <p className="text-xs text-gray-500">{log.totalPages} pages</p>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[log.status]}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.fieldsExtracted}/{log.totalFields}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {log.confidenceScore !== null ? (
                        <div>
                          <span className={`font-medium ${
                            log.confidenceLevel ? confidenceColors[log.confidenceLevel] : 'text-gray-600'
                          }`}>
                            {log.confidenceScore}%
                          </span>
                          {log.confidenceLevel && (
                            <p className="text-xs text-gray-500">{log.confidenceLevel}</p>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {new Date(log.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedLog(log);
                            setActiveTab('review');
                          }}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Review
                        </button>
                        {(log.status === 'FAILED' || log.status === 'PARTIAL') && (
                          <button
                            onClick={() => handleReprocess(log.id)}
                            className="text-orange-600 hover:text-orange-900"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="text-gray-500">No extractions yet</p>
            <button
              onClick={() => setActiveTab('upload')}
              className="mt-4 text-blue-600 hover:underline"
            >
              Upload your first DRHP
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      {extractionLogs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-600">Total Extractions</p>
            <p className="text-2xl font-bold text-gray-900">{extractionLogs.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-600">Success Rate</p>
            <p className="text-2xl font-bold text-green-600">
              {Math.round(
                (extractionLogs.filter(l => l.status === 'SUCCESS').length / extractionLogs.length) * 100
              )}%
            </p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-600">Avg. Confidence</p>
            <p className="text-2xl font-bold text-blue-600">
              {Math.round(
                extractionLogs
                  .filter(l => l.confidenceScore !== null)
                  .reduce((sum, l) => sum + (l.confidenceScore || 0), 0) /
                  extractionLogs.filter(l => l.confidenceScore !== null).length || 0
              )}%
            </p>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-sm text-gray-600">Fields Extracted</p>
            <p className="text-2xl font-bold text-gray-900">
              {extractionLogs.reduce((sum, l) => sum + l.fieldsExtracted, 0)}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const renderReviewTab = () => {
    if (!selectedLog) {
      return (
        <div className="bg-white rounded-lg shadow-sm p-8 text-center">
          <p className="text-gray-500">Select an extraction from the history to review</p>
          <button
            onClick={() => setActiveTab('history')}
            className="mt-4 text-blue-600 hover:underline"
          >
            View History
          </button>
        </div>
      );
    }

    const extractedData = selectedLog.extractedData || {};

    return (
      <div className="space-y-6">
        {/* Extraction Summary */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">{selectedLog.companyName}</h3>
              <p className="text-sm text-gray-600">{selectedLog.fileName}</p>
            </div>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[selectedLog.status]}`}>
              {selectedLog.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Extracted:</span>
              <span className="ml-2 font-medium">{selectedLog.fieldsExtracted}/{selectedLog.totalFields}</span>
            </div>
            <div>
              <span className="text-gray-500">Confidence:</span>
              <span className={`ml-2 font-medium ${
                selectedLog.confidenceLevel ? confidenceColors[selectedLog.confidenceLevel] : ''
              }`}>
                {selectedLog.confidenceScore}%
              </span>
            </div>
            <div>
              <span className="text-gray-500">Duration:</span>
              <span className="ml-2 font-medium">
                {selectedLog.durationMs ? `${(selectedLog.durationMs / 1000).toFixed(2)}s` : '-'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Method:</span>
              <span className="ml-2 font-medium">{selectedLog.extractionMethod || 'Unknown'}</span>
            </div>
          </div>
        </div>

        {/* Extracted Data */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h4 className="text-lg font-semibold text-gray-900">Extracted Financial Data</h4>
          </div>

          <div className="p-6">
            {Object.keys(extractedData).length > 0 ? (
              <div className="space-y-4">
                {Object.entries(extractedData).map(([key, value]: [string, any]) => (
                  <div key={key} className="border-b border-gray-100 pb-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </p>
                        <p className="text-lg font-semibold text-gray-900 mt-1">
                          {typeof value === 'object' ? JSON.stringify(value, null, 2) : value}
                        </p>
                      </div>
                      <div className="ml-4 text-right">
                        {value?.confidence && (
                          <span className="text-xs text-gray-500">
                            {value.confidence}% confidence
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No data extracted</p>
            )}
          </div>
        </div>

        {/* Data Issues */}
        {selectedLog.dataIssues && selectedLog.dataIssues.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
            <h4 className="text-lg font-semibold text-yellow-900 mb-3">Data Issues Detected</h4>
            <ul className="list-disc list-inside space-y-1 text-sm text-yellow-800">
              {selectedLog.dataIssues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-between">
          <button
            onClick={() => setActiveTab('history')}
            className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Back to History
          </button>
          <div className="space-x-3">
            <Link
              href={`/admin/dynamic/extractionLogs/${selectedLog.id}`}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block"
            >
              Edit in Dynamic Admin
            </Link>
            {selectedLog.ipoId && (
              <Link
                href={`/admin/edit/${selectedLog.ipoId}`}
                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 inline-block"
              >
                Edit IPO
              </Link>
            )}
          </div>
        </div>
      </div>
    );
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                DRHP Extraction System
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Extract financial data from DRHP PDFs using AI-powered parsers
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

      {/* Alerts */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-sm text-green-800">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Upload PDF
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'history'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Extraction History
              {extractionLogs.length > 0 && (
                <span className="ml-2 bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                  {extractionLogs.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('review')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'review'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Review Data
            </button>
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'upload' && renderUploadTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'review' && renderReviewTab()}
      </div>
    </div>
  );
}