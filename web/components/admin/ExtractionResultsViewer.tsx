/**
 * Extraction Results Viewer Component
 *
 * Displays DRHP extraction results with confidence scores and allows
 * one-click copying of extracted data to form fields.
 *
 * Part of Phase 6: Admin Enhancement - Week 3 Final Integration
 */

'use client';

import { useState, useEffect } from 'react';
import { adminGet } from '@/lib/admin/admin-api-client';

interface ExtractionLog {
  id: string;
  ipoId: string | null;
  companyName: string;
  fileName: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  extractorVersion: string | null;
  extractionMethod: string | null;
  fieldsExtracted: number;
  totalFields: number;
  extractedData: Record<string, any> | null;
  confidenceScore: number | null;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  dataIssues: string[] | null;
  createdAt: string;
  processedAt: string | null;
}

interface ExtractedField {
  field: string;
  value: any;
  unit: string;
  confidence: number;
  source: string;
  displayName: string;
}

interface ExtractionResultsViewerProps {
  ipoId: string;
  onCopyField?: (fieldName: string, value: any) => void;
  onCopyAll?: (fields: Record<string, any>) => void;
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

// Field mapping: extractedData key -> Display name
const fieldDisplayNames: Record<string, string> = {
  revenueFy2022: 'Revenue FY2022',
  revenueFy2023: 'Revenue FY2023',
  profitFy2022: 'Profit FY2022',
  profitFy2023: 'Profit FY2023',
  netWorth: 'Net Worth',
  peRatio: 'P/E Ratio',
  roe: 'ROE',
  debtToEquity: 'Debt to Equity',
  earningsPerShare: 'EPS',
  nav: 'NAV',
  faceValue: 'Face Value',
  reservesAndSurplus: 'Reserves & Surplus',
  totalAssets: 'Total Assets',
  totalLiabilities: 'Total Liabilities',
  cashAndEquivalents: 'Cash & Equivalents',
  totalEquity: 'Total Equity'
};

export default function ExtractionResultsViewer({
  ipoId,
  onCopyField,
  onCopyAll
}: ExtractionResultsViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [extractionLog, setExtractionLog] = useState<ExtractionLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    loadLatestExtraction();
  }, [ipoId]);

  const loadLatestExtraction = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch extraction logs for this IPO using optimized endpoint
      const response = await adminGet(`/api/admin/drhp/ipo/${ipoId}`);

      if (response.success && response.data?.latest) {
        setExtractionLog(response.data.latest);
      } else {
        setExtractionLog(null);
      }
    } catch (err) {
      console.error('Failed to load extraction:', err);
      setError('Failed to load extraction results');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyField = (fieldName: string, value: any) => {
    if (onCopyField) {
      onCopyField(fieldName, value);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleCopyAll = () => {
    if (onCopyAll && extractionLog?.extractedData) {
      onCopyAll(extractionLog.extractedData);
    }
  };

  const formatValue = (value: any, unit?: string): string => {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'number') {
      return unit ? `${value.toFixed(2)} ${unit}` : value.toFixed(2);
    }
    return String(value);
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 80) return 'text-green-600';
    if (confidence >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-400">Loading extraction results...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 rounded-lg border border-red-700 p-6">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  if (!extractionLog) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-4 text-gray-400">No DRHP extraction found for this IPO</p>
          <p className="mt-2 text-sm text-gray-500">Upload a DRHP PDF to extract financial data</p>
        </div>
      </div>
    );
  }

  const extractedFields: ExtractedField[] = extractionLog.extractedData
    ? Object.entries(extractionLog.extractedData)
        .filter(([key]) => key !== 'metadata' && fieldDisplayNames[key])
        .map(([key, value]) => ({
          field: key,
          value: value,
          unit: key.includes('revenue') || key.includes('profit') || key.includes('netWorth') ? '₹ Cr' : '',
          confidence: extractionLog.confidenceScore || 0,
          source: extractionLog.extractionMethod || 'Unknown',
          displayName: fieldDisplayNames[key] || key
        }))
    : [];

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <svg className="h-6 w-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div>
              <h3 className="text-lg font-semibold text-white">DRHP Extraction Results</h3>
              <p className="text-sm text-gray-400">From {extractionLog.fileName}</p>
            </div>
          </div>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-blue-500 hover:text-blue-400 font-medium text-sm"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {/* Status Bar */}
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[extractionLog.status]}`}>
              {extractionLog.status}
            </span>
            {extractionLog.confidenceLevel && (
              <span className={`text-sm font-medium ${confidenceColors[extractionLog.confidenceLevel]}`}>
                {extractionLog.confidenceScore}% Confidence ({extractionLog.confidenceLevel})
              </span>
            )}
            <span className="text-sm text-gray-400">
              {extractionLog.fieldsExtracted} / {extractionLog.totalFields} fields
            </span>
          </div>
          {extractedFields.length > 0 && (
            <button
              onClick={handleCopyAll}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Copy All Fields
            </button>
          )}
        </div>

        {/* Data Issues */}
        {extractionLog.dataIssues && extractionLog.dataIssues.length > 0 && (
          <div className="mt-3 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded">
            <p className="text-sm font-medium text-yellow-400 mb-2">⚠️ Data Issues Found:</p>
            <ul className="list-disc list-inside text-sm text-yellow-300 space-y-1">
              {extractionLog.dataIssues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Extracted Fields */}
      {isExpanded && extractedFields.length > 0 && (
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {extractedFields.map((field) => (
              <div
                key={field.field}
                className="p-4 bg-gray-900 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-400 mb-1">
                      {field.displayName}
                    </label>
                    <div className="flex items-baseline space-x-2">
                      <span className="text-lg font-semibold text-white">
                        {formatValue(field.value, field.unit)}
                      </span>
                      <span className={`text-xs font-medium ${getConfidenceColor(field.confidence)}`}>
                        {field.confidence}%
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleCopyField(field.field, field.value)}
                    className={`ml-3 px-3 py-1 rounded text-xs font-medium transition-colors ${
                      copiedField === field.field
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {copiedField === field.field ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Metadata */}
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>Method: {extractionLog.extractionMethod || 'Unknown'}</span>
              <span>Version: {extractionLog.extractorVersion || 'Unknown'}</span>
              <span>Extracted: {new Date(extractionLog.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {isExpanded && extractedFields.length === 0 && (
        <div className="p-6 text-center text-gray-400">
          <p>No financial data extracted from this DRHP</p>
        </div>
      )}
    </div>
  );
}
