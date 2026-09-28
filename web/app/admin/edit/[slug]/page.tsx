'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { adminGet } from '@/lib/admin/admin-api-client';
import type {
  IPO,
  FinancialData,
  Subscription,
  GMPRecord,
  Document
} from '@/lib/db/types';

interface FieldProtection {
  id: string;
  tableName: string;
  fieldName: string;
  isProtected: boolean;
  autoProtected: boolean;
  editNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IPOObjective {
  sno: number;
  description: string;
  amount: number | null;
}

/**
 * §9.4: there is one place an admin value is written — the IPO-page editor (OD-102).
 * This legacy screen is READ-ONLY: it shows the IPO's current data, protection state
 * and documents, and links to where a value is actually changed.
 */
export default function AdminEditIPOPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [ipo, setIpo] = useState<IPO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('basic');
  const [protectedFields, setProtectedFields] = useState<FieldProtection[]>([]);
  const [isLoadingProtections, setIsLoadingProtections] = useState(false);
  const [financialData, setFinancialData] = useState<FinancialData | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [gmpRecords, setGmpRecords] = useState<GMPRecord[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);

  useEffect(() => {
    if (slug) {
      fetchIPO();
    }
  }, [slug]);

  useEffect(() => {
    if (ipo && activeTab === 'protection') {
      fetchProtectedFields();
    }
    if (ipo && activeTab === 'financials') {
      fetchFinancialData();
    }
    if (ipo && activeTab === 'subscriptions') {
      fetchSubscriptionData();
    }
    if (ipo && activeTab === 'gmp') {
      fetchGMPData();
    }
    if (ipo && activeTab === 'documents') {
      fetchDocuments();
    }
  }, [ipo, activeTab]);

  const fetchIPO = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      if (data.ipo) {
        setIpo(data.ipo);
      } else if (data.success) {
        setIpo(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch IPO:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProtectedFields = async () => {
    if (!ipo) return;
    try {
      setIsLoadingProtections(true);
      const data = await adminGet(`/api/admin/protection/fields/${ipo.id}`);
      setProtectedFields(data.data?.protections || []);
    } catch (error) {
      console.error('Failed to fetch protected fields:', error);
      setProtectedFields([]);
    } finally {
      setIsLoadingProtections(false);
    }
  };

  const fetchFinancialData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      if (data.financialData) setFinancialData(data.financialData);
    } catch (error) {
      console.error('Failed to fetch financial data:', error);
    }
  };

  const fetchSubscriptionData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      if (data.subscriptions && data.subscriptions.length > 0) setSubscriptions(data.subscriptions);
    } catch (error) {
      console.error('Failed to fetch subscription data:', error);
    }
  };

  const fetchGMPData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      if (data.gmpRecords && data.gmpRecords.length > 0) setGmpRecords(data.gmpRecords);
    } catch (error) {
      console.error('Failed to fetch GMP data:', error);
    }
  };

  const fetchDocuments = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      if (data.documents && data.documents.length > 0) setDocuments(data.documents);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-400">Loading IPO...</p>
        </div>
      </div>
    );
  }

  if (!ipo) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-white mb-4">IPO Not Found</h2>
        <Link href="/admin" className="text-blue-500 hover:underline">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  const objectives: IPOObjective[] = ipo.objectives || [];
  const basicFields: Array<{ label: string; value: unknown }> = [
    { label: 'Company Name', value: ipo.companyName },
    { label: 'Status', value: ipo.status },
    { label: 'Lot Size', value: ipo.lotSize },
    { label: 'Price Range Min (₹)', value: ipo.priceRangeMin },
    { label: 'Price Range Max (₹)', value: ipo.priceRangeMax },
    { label: 'Open Date', value: ipo.openDate },
    { label: 'Close Date', value: ipo.closeDate },
    { label: 'Listing Date', value: ipo.listingDate },
    { label: 'Issue Size', value: ipo.issueSize },
    { label: 'Face Value (₹)', value: ipo.faceValue },
  ];

  return (
    <div className="space-y-6">
      {/* Read-only notice (§9.4): values are written only on the IPO page editor */}
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-yellow-800">
              Read-only screen
            </h3>
            <p className="mt-2 text-sm text-yellow-700">
              Values are now edited on the{' '}
              <Link href={`/ipo/${ipo.slug}`} className="font-semibold underline hover:text-yellow-900">
                IPO page
              </Link>{' '}
              (Edit control, admin only). This screen shows the current data, protection state and
              documents for reference — it does not save anything.
            </p>
          </div>
        </div>
      </div>

      {/* Header */}
      <div>
        <Link href="/admin" className="text-blue-500 hover:underline text-sm mb-2 inline-block">
          ← Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-white">{ipo.companyName}</h1>
        <p className="text-gray-400 mt-1">{ipo.slug}</p>
        {ipo.scraperLocked && (
          <span className="inline-flex items-center space-x-1 text-red-400 mt-2">
            <span>🔒</span>
            <span className="text-sm font-medium">IPO Locked</span>
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="border-b border-gray-700 px-6">
          <div className="flex space-x-8 overflow-x-auto">
            {[
              { key: 'basic', label: 'Basic Info' },
              { key: 'financials', label: 'Financials' },
              { key: 'objectives', label: 'Objectives' },
              { key: 'subscriptions', label: 'Subscriptions' },
              { key: 'gmp', label: 'GMP' },
              { key: 'documents', label: 'Documents' },
              { key: 'protection', label: 'Protection' },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Basic Info Tab (read-only) */}
          {activeTab === 'basic' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {basicFields.map((f) => (
                <div key={f.label}>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{f.label}</label>
                  <div className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white">
                    {f.value === null || f.value === undefined || f.value === '' ? 'N/A' : String(f.value)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Financials Tab (read-only) */}
          {activeTab === 'financials' && (
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Financial Data</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { label: 'Revenue FY2022 (₹ Cr)', value: financialData?.revenueFy2022 },
                  { label: 'Revenue FY2023 (₹ Cr)', value: financialData?.revenueFy2023 },
                  { label: 'Profit FY2022 (₹ Cr)', value: financialData?.profitFy2022 },
                  { label: 'Profit FY2023 (₹ Cr)', value: financialData?.profitFy2023 },
                  { label: 'P/E Ratio', value: financialData?.peRatio },
                  { label: 'ROE (%)', value: financialData?.roe },
                  { label: 'Debt to Equity', value: financialData?.debtToEquity },
                  { label: 'Net Worth (₹ Cr)', value: financialData?.netWorth },
                ].map((f) => (
                  <div key={f.label}>
                    <label className="block text-sm font-medium text-gray-300 mb-2">{f.label}</label>
                    <div className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white">
                      {f.value === null || f.value === undefined || f.value === '' ? 'N/A' : String(f.value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subscriptions Tab (read-only) */}
          {activeTab === 'subscriptions' && (
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Subscription Data</h3>
              {subscriptions && subscriptions.length > 0 ? (
                <div className="space-y-4">
                  {subscriptions.slice(0, 5).map((sub, index) => (
                    <div key={sub.id} className={`p-4 bg-gray-800 rounded-lg border ${index === 0 ? 'border-blue-500/50' : 'border-gray-700'}`}>
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="text-sm font-semibold text-white">
                          Snapshot #{subscriptions.length - index}
                          {index === 0 && <span className="ml-2 text-xs text-blue-400">(Latest)</span>}
                        </h4>
                        <span className="text-xs text-gray-400">{new Date(sub.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div>
                          <div className="text-xs text-gray-400">Overall</div>
                          <div className="text-sm font-medium text-white">{sub.totalSubscription ? Number(sub.totalSubscription).toFixed(2) : 'N/A'}x</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">QIB</div>
                          <div className="text-sm font-medium text-white">{sub.qibSubscription ? Number(sub.qibSubscription).toFixed(2) : 'N/A'}x</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">NII</div>
                          <div className="text-sm font-medium text-white">{sub.niiSubscription ? Number(sub.niiSubscription).toFixed(2) : 'N/A'}x</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">Retail</div>
                          <div className="text-sm font-medium text-white">{sub.retailSubscription ? Number(sub.retailSubscription).toFixed(2) : 'N/A'}x</div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {subscriptions.length > 5 && (
                    <p className="text-xs text-gray-400 text-center">Showing latest 5 of {subscriptions.length} snapshots</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">No subscription data available.</p>
                </div>
              )}
            </div>
          )}

          {/* GMP Tab (read-only) */}
          {activeTab === 'gmp' && (
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Grey Market Premium (GMP)</h3>
              {gmpRecords && gmpRecords.length > 0 ? (
                <div className="space-y-4">
                  {gmpRecords.slice(0, 10).map((gmp) => (
                    <div key={gmp.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                      <div className="flex justify-between items-start mb-3">
                        <h4 className="text-sm font-semibold text-white">₹{gmp.gmp} Premium</h4>
                        <span className="text-xs text-gray-400">{new Date(gmp.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {gmp.expectedListingPrice && (
                          <div>
                            <div className="text-xs text-gray-400">Expected Listing Price</div>
                            <div className="text-sm font-medium text-white">₹{gmp.expectedListingPrice}</div>
                          </div>
                        )}
                        {gmp.source && (
                          <div>
                            <div className="text-xs text-gray-400">Source</div>
                            <div className="text-sm font-medium text-white">{gmp.source}</div>
                          </div>
                        )}
                        {gmp.saudaDetails && (
                          <div className="col-span-2">
                            <div className="text-xs text-gray-400">Sauda Details</div>
                            <div className="text-sm font-medium text-white">{gmp.saudaDetails}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {gmpRecords.length > 10 && (
                    <p className="text-xs text-gray-400 text-center">Showing latest 10 of {gmpRecords.length} records</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">No GMP data available.</p>
                </div>
              )}
            </div>
          )}

          {/* Documents Tab (read-only) */}
          {activeTab === 'documents' && (
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">IPO Documents</h3>
              {documents && documents.length > 0 ? (
                <div className="space-y-3">
                  {documents.map((doc) => (
                    <div key={doc.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <h4 className="text-sm font-semibold text-white">{doc.title}</h4>
                            <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded">{doc.type}</span>
                            <span className="text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded">{doc.mediaType}</span>
                            {!doc.isActive && (
                              <span className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded">Inactive</span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-400">
                            {doc.exchange && <div><span className="font-medium">Exchange:</span> {doc.exchange}</div>}
                            <div><span className="font-medium">Sequence:</span> #{doc.sequenceNumber}</div>
                            {doc.fileSize && <div><span className="font-medium">Size:</span> {(doc.fileSize / 1024 / 1024).toFixed(2)} MB</div>}
                            <div><span className="font-medium">Uploaded:</span> {new Date(doc.uploadedAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 ml-4">
                          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors">
                            View
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">No documents available.</p>
                </div>
              )}
            </div>
          )}

          {/* Objectives Tab (read-only) */}
          {activeTab === 'objectives' && (
            <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Objects of the Issue</h3>
              {objectives.length > 0 ? (
                <div className="space-y-3">
                  {objectives.map((obj) => (
                    <div key={obj.sno} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                      <div className="grid grid-cols-12 gap-4 items-start">
                        <div className="col-span-1 text-sm text-gray-400">#{obj.sno}</div>
                        <div className="col-span-8 text-sm text-white">{obj.description}</div>
                        <div className="col-span-3 text-sm text-white">
                          {obj.amount !== null ? `₹${obj.amount.toFixed(2)} Cr` : 'General Corporate Purposes'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">No objectives defined yet.</p>
                </div>
              )}
            </div>
          )}

          {/* Protection Settings Tab (read-only) */}
          {activeTab === 'protection' && (
            <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-2">IPO-Level Lock</h3>
                <p className="text-sm text-gray-400">
                  {ipo.scraperLocked
                    ? 'This IPO is locked. All scraper updates are blocked.'
                    : 'This IPO is unlocked. Scrapers can update non-protected fields.'}
                </p>
                {ipo.scraperLockNote && (
                  <div className="mt-4 p-3 bg-gray-800 rounded border border-gray-700">
                    <div className="text-xs text-gray-500 mb-1">Lock Note:</div>
                    <div className="text-sm text-gray-300">{ipo.scraperLockNote}</div>
                  </div>
                )}
              </div>

              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Field-Level Protection</h3>
                {isLoadingProtections ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : protectedFields.length > 0 ? (
                  <div className="space-y-2">
                    {protectedFields.map((p) => (
                      <div key={p.id} className="flex items-center justify-between p-3 bg-gray-800 rounded border border-gray-700">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="text-sm font-medium text-white">{p.tableName}.{p.fieldName}</span>
                            {p.autoProtected && (
                              <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded">Auto-protected</span>
                            )}
                          </div>
                          {p.editNote && <p className="text-xs text-gray-500 mt-1">{p.editNote}</p>}
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${p.isProtected ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-300'}`}>
                          {p.isProtected ? 'Protected' : 'Not protected'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-sm">No field protections configured yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
