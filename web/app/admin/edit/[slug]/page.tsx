'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import Link from 'next/link';
import { adminGet, adminPost, adminPatch, adminDelete } from '@/lib/admin/admin-api-client';
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

export default function AdminEditIPOPage() {
  const params = useParams();
  const router = useRouter();
  const { token } = useAdminAuth();
  const slug = params.slug as string;

  console.log('[AdminEditIPOPage] Rendering component for slug:', slug);

  const [ipo, setIpo] = useState<IPO | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [editedData, setEditedData] = useState<Partial<IPO>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [protectedFields, setProtectedFields] = useState<FieldProtection[]>([]);
  const [isLoadingProtections, setIsLoadingProtections] = useState(false);
  const [financialData, setFinancialData] = useState<FinancialData | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [gmpRecords, setGmpRecords] = useState<GMPRecord[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [editedFinancials, setEditedFinancials] = useState<Partial<FinancialData>>({});
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [showGMPModal, setShowGMPModal] = useState(false);
  const [editingGMP, setEditingGMP] = useState<GMPRecord | null>(null);
  const [gmpFormData, setGmpFormData] = useState({
    gmpPrice: '',
    gmpPercentage: '',
    estimatedListingPrice: '',
    subject: '',
    source: '',
    recordedAt: new Date().toISOString().slice(0, 16),
    autoProtect: true,
  });
  const [isEditingSubscription, setIsEditingSubscription] = useState(false);
  const [editedSubscription, setEditedSubscription] = useState<Partial<Subscription>>({});
  const [autoProtectSubscription, setAutoProtectSubscription] = useState(true);

  useEffect(() => {
    console.log('[AdminEditIPOPage] useEffect triggered for slug:', slug);
    if (slug) {
      console.log('[AdminEditIPOPage] Fetching IPO data...');
      fetchIPO();
    } else {
      console.log('[AdminEditIPOPage] Slug is undefined, skipping fetchIPO');
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

      console.log('[Admin Edit Debug] API Response:', {
        hasIpo: !!data.ipo,
        hasSuccess: !!data.success,
        hasError: !!data.error,
        ipoCompanyName: data.ipo?.companyName,
        dataKeys: Object.keys(data)
      });

      // API returns { ipo: {...}, financialData: {...}, ... }
      if (data.ipo) {
        console.log('[Admin Edit Debug] Setting IPO state:', data.ipo.companyName);
        setIpo(data.ipo);
      } else if (data.success) {
        // Fallback for old format
        console.log('[Admin Edit Debug] Using fallback format');
        setIpo(data.data);
      } else {
        console.log('[Admin Edit Debug] No IPO data found in response');
      }
    } catch (error) {
      console.error('Failed to fetch IPO:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFieldChange = (field: string, value: any) => {
    setEditedData((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleIPOLock = async () => {
    if (!ipo) return;

    const newLockState = !ipo.scraperLocked;

    try {
      setIsSaving(true);
      await adminPatch(`/api/admin/protection/ipo/${ipo.id}`, {
        scraperLocked: newLockState,
        scraperLockNote: newLockState ? 'Manually locked via admin panel' : null
      });

      setIpo({ ...ipo, scraperLocked: newLockState });
      setSuccessMessage(newLockState ? 'IPO locked successfully' : 'IPO unlocked successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Failed to toggle IPO lock:', error);
      setSuccessMessage('Error: Failed to toggle IPO lock');
      setTimeout(() => setSuccessMessage(''), 3000);
    } finally {
      setIsSaving(false);
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
      // Gracefully handle - show empty list
      setProtectedFields([]);
    } finally {
      setIsLoadingProtections(false);
    }
  };

  const handleToggleFieldProtection = async (tableName: string, fieldName: string, currentlyProtected: boolean) => {
    if (!ipo) return;

    try {
      setIsSaving(true);
      await adminPost(`/api/admin/protection/fields/${ipo.id}`, {
        tableName,
        fieldName,
        isProtected: !currentlyProtected,
        editNote: !currentlyProtected ? 'Manually protected via admin panel' : 'Protection removed via admin panel'
      });

      setSuccessMessage(`Field ${fieldName} ${!currentlyProtected ? 'protected' : 'unprotected'} successfully`);
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchProtectedFields(); // Refresh protections
    } catch (error) {
      console.error('Failed to toggle field protection:', error);
      setSuccessMessage('Error: Failed to toggle field protection');
      setTimeout(() => setSuccessMessage(''), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const fetchFinancialData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      console.log('[Admin Edit Debug] Financial data response:', data.financialData);
      if (data.financialData) {
        setFinancialData(data.financialData);
      }
    } catch (error) {
      console.error('Failed to fetch financial data:', error);
    }
  };

  const fetchSubscriptionData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      console.log('[Admin Edit Debug] Subscriptions response:', {
        hasSubscriptions: !!data.subscriptions,
        count: data.subscriptions?.length || 0,
        subscriptions: data.subscriptions
      });
      if (data.subscriptions && data.subscriptions.length > 0) {
        setSubscriptions(data.subscriptions);
      }
    } catch (error) {
      console.error('Failed to fetch subscription data:', error);
    }
  };

  const fetchGMPData = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      console.log('[Admin Edit Debug] GMP data response:', {
        hasGmpRecords: !!data.gmpRecords,
        count: data.gmpRecords?.length || 0
      });
      if (data.gmpRecords && data.gmpRecords.length > 0) {
        setGmpRecords(data.gmpRecords);
      }
    } catch (error) {
      console.error('Failed to fetch GMP data:', error);
    }
  };

  const fetchDocuments = async () => {
    if (!ipo) return;
    try {
      const response = await fetch(`/api/ipos/${slug}`);
      const data = await response.json();
      console.log('[Admin Edit Debug] Documents response:', {
        hasDocuments: !!data.documents,
        count: data.documents?.length || 0
      });
      if (data.documents && data.documents.length > 0) {
        setDocuments(data.documents);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    }
  };

  const handleBulkProtect = async (protect: boolean) => {
    if (!ipo || selectedFields.length === 0) return;

    try {
      setIsSaving(true);
      await adminPost(`/api/admin/protection/fields/bulk`, {
        ipoId: ipo.id,
        tableName: 'ipos',
        fieldNames: selectedFields,
        isProtected: protect
      });

      setSuccessMessage(`${selectedFields.length} fields ${protect ? 'protected' : 'unprotected'} successfully`);
      setTimeout(() => setSuccessMessage(''), 3000);
      setSelectedFields([]);
      await fetchProtectedFields(); // Refresh protections
    } catch (error) {
      console.error('Failed to bulk protect fields:', error);
      setSuccessMessage('Error: Failed to bulk protect fields');
      setTimeout(() => setSuccessMessage(''), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFieldSelection = (fieldName: string) => {
    setSelectedFields(prev =>
      prev.includes(fieldName)
        ? prev.filter(f => f !== fieldName)
        : [...prev, fieldName]
    );
  };

  const selectAllFields = () => {
    const allFields = ['companyName', 'status', 'lotSize', 'priceRangeMin', 'priceRangeMax', 'openDate', 'closeDate', 'listingDate', 'issueSize', 'faceValue'];
    setSelectedFields(allFields);
  };

  const deselectAllFields = () => {
    setSelectedFields([]);
  };

  const handleSaveField = async (tableName: string, fieldName: string, value: any, autoProtect: boolean = true, recordId?: string) => {
    if (!ipo) return;

    try {
      setIsSaving(true);
      await adminPatch('/api/admin/update-field', {
        ipoId: ipo.id,
        tableName,
        fieldName,
        value,
        recordId, // For subscription records
        autoProtect,
        editNote: `Updated via admin panel`
      });

      setSuccessMessage(`Field ${fieldName} updated successfully`);
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchIPO(); // Refresh data
      await fetchProtectedFields(); // Refresh protections
    } catch (error) {
      console.error('Failed to save field:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save field';
      setSuccessMessage(`Error: ${errorMsg}`);
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartEditSubscription = () => {
    if (subscriptions && subscriptions.length > 0) {
      const latestSubscription = subscriptions[0];
      setEditedSubscription({
        id: latestSubscription.id,
        totalSubscription: latestSubscription.totalSubscription,
        qibSubscription: latestSubscription.qibSubscription,
        niiSubscription: latestSubscription.niiSubscription,
        retailSubscription: latestSubscription.retailSubscription,
        employeeSubscription: latestSubscription.employeeSubscription,
        othersSubscription: latestSubscription.othersSubscription,
        totalApplications: latestSubscription.totalApplications,
      });
      setIsEditingSubscription(true);
    }
  };

  const handleCancelEditSubscription = () => {
    setIsEditingSubscription(false);
    setEditedSubscription({});
  };

  const validateSubscriptionChange = (original: string | number | null, updated: string | number | null): boolean => {
    if (original === null || updated === null) return true;
    const origNum = typeof original === 'string' ? Number(original) : original;
    const updatedNum = typeof updated === 'string' ? Number(updated) : updated;
    const percentChange = Math.abs(((updatedNum - origNum) / origNum) * 100);
    return percentChange <= 500; // Max 500% change warning threshold
  };

  const handleSaveSubscription = async () => {
    if (!subscriptions || subscriptions.length === 0 || !editedSubscription.id) return;

    const latestSubscription = subscriptions[0];

    // Validate subscription values
    const fields = ['overallSubscription', 'qibSubscription', 'niiSubscription', 'retailSubscription'];
    for (const field of fields) {
      const value = editedSubscription[field as keyof Subscription] as number | null;
      if (value !== null && value < 0) {
        setSuccessMessage(`Error: ${field} cannot be negative`);
        setTimeout(() => setSuccessMessage(''), 5000);
        return;
      }
    }

    // Check for significant changes
    const hasSignificantChange =
      !validateSubscriptionChange(latestSubscription.totalSubscription, editedSubscription.totalSubscription ?? null) ||
      !validateSubscriptionChange(latestSubscription.qibSubscription, editedSubscription.qibSubscription ?? null) ||
      !validateSubscriptionChange(latestSubscription.niiSubscription, editedSubscription.niiSubscription ?? null) ||
      !validateSubscriptionChange(latestSubscription.retailSubscription, editedSubscription.retailSubscription ?? null);

    if (hasSignificantChange) {
      const confirmed = window.confirm(
        'Warning: One or more subscription values changed significantly (>500%). Are you sure you want to save these changes?'
      );
      if (!confirmed) return;
    }

    // Save all changed fields
    try {
      setIsSaving(true);
      const updatePromises = [];

      // Update each field that has changed
      if (editedSubscription.totalSubscription !== latestSubscription.totalSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'totalSubscription', editedSubscription.totalSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.qibSubscription !== latestSubscription.qibSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'qibSubscription', editedSubscription.qibSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.niiSubscription !== latestSubscription.niiSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'niiSubscription', editedSubscription.niiSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.retailSubscription !== latestSubscription.retailSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'retailSubscription', editedSubscription.retailSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.employeeSubscription !== latestSubscription.employeeSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'employeeSubscription', editedSubscription.employeeSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.othersSubscription !== latestSubscription.othersSubscription) {
        updatePromises.push(
          handleSaveField('subscriptions', 'othersSubscription', editedSubscription.othersSubscription, autoProtectSubscription, editedSubscription.id)
        );
      }
      if (editedSubscription.totalApplications !== latestSubscription.totalApplications) {
        updatePromises.push(
          handleSaveField('subscriptions', 'totalApplications', editedSubscription.totalApplications, autoProtectSubscription, editedSubscription.id)
        );
      }

      await Promise.all(updatePromises);

      await fetchSubscriptionData(); // Refresh subscription data
      setIsEditingSubscription(false);
      setEditedSubscription({});
      setSuccessMessage('Subscription data updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Failed to save subscription:', error);
      setSuccessMessage('Error: Failed to save subscription data');
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  // GMP Record Handlers
  const handleOpenAddGMP = () => {
    setEditingGMP(null);
    setGmpFormData({
      gmpPrice: '',
      gmpPercentage: '',
      estimatedListingPrice: '',
      subject: '',
      source: '',
      recordedAt: new Date().toISOString().slice(0, 16),
      autoProtect: true,
    });
    setShowGMPModal(true);
  };

  const handleOpenEditGMP = (gmp: GMPRecord) => {
    setEditingGMP(gmp);
    setGmpFormData({
      gmpPrice: gmp.gmp?.toString() || '',
      gmpPercentage: '',
      estimatedListingPrice: gmp.expectedListingPrice?.toString() || '',
      subject: gmp.saudaDetails || '',
      source: gmp.source || '',
      recordedAt: new Date(gmp.timestamp).toISOString().slice(0, 16),
      autoProtect: true,
    });
    setShowGMPModal(true);
  };

  const handleCloseGMPModal = () => {
    setShowGMPModal(false);
    setEditingGMP(null);
    setGmpFormData({
      gmpPrice: '',
      gmpPercentage: '',
      estimatedListingPrice: '',
      subject: '',
      source: '',
      recordedAt: new Date().toISOString().slice(0, 16),
      autoProtect: true,
    });
  };

  const handleSaveGMP = async () => {
    if (!ipo) return;

    // Validation
    if (!gmpFormData.gmpPrice || parseFloat(gmpFormData.gmpPrice) < 0) {
      setSuccessMessage('Error: GMP Price is required and must be >= 0');
      setTimeout(() => setSuccessMessage(''), 5000);
      return;
    }

    if (!gmpFormData.source || gmpFormData.source.trim() === '') {
      setSuccessMessage('Error: Source is required');
      setTimeout(() => setSuccessMessage(''), 5000);
      return;
    }

    try {
      setIsSaving(true);

      const requestBody = {
        gmpPrice: parseFloat(gmpFormData.gmpPrice),
        gmpPercentage: gmpFormData.gmpPercentage ? parseFloat(gmpFormData.gmpPercentage) : undefined,
        estimatedListingPrice: gmpFormData.estimatedListingPrice ? parseFloat(gmpFormData.estimatedListingPrice) : undefined,
        subject: gmpFormData.subject || undefined,
        source: gmpFormData.source,
        recordedAt: gmpFormData.recordedAt,
        autoProtect: gmpFormData.autoProtect,
        editNote: editingGMP ? `Updated GMP record` : `New GMP record created`,
      };

      if (editingGMP) {
        (requestBody as any).recordId = editingGMP.id;
        await adminPatch(`/api/admin/gmp/${ipo.id}`, requestBody);
      } else {
        await adminPost(`/api/admin/gmp/${ipo.id}`, requestBody);
      }

      setSuccessMessage(editingGMP ? 'GMP record updated successfully' : 'GMP record created successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchGMPData(); // Refresh GMP data
      handleCloseGMPModal();
    } catch (error) {
      console.error('Failed to save GMP record:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to save GMP record';
      setSuccessMessage(`Error: ${errorMsg}`);
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGMP = async (gmpId: string) => {
    if (!ipo) return;

    const confirmed = window.confirm('Are you sure you want to delete this GMP record?');
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await adminDelete(`/api/admin/gmp/${ipo.id}?recordId=${gmpId}`);

      setSuccessMessage('GMP record deleted successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
      await fetchGMPData(); // Refresh GMP data
    } catch (error) {
      console.error('Failed to delete GMP record:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete GMP record';
      setSuccessMessage(`Error: ${errorMsg}`);
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setIsSaving(false);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <Link href="/admin" className="text-blue-500 hover:underline text-sm mb-2 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-white">{ipo.companyName}</h1>
          <p className="text-gray-400 mt-1">{ipo.slug}</p>
        </div>

        <div className="flex items-center space-x-4">
          {ipo.scraperLocked && (
            <span className="inline-flex items-center space-x-1 text-red-400">
              <span>🔒</span>
              <span className="text-sm font-medium">IPO Locked</span>
            </span>
          )}
        </div>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="bg-green-500/10 border border-green-500 text-green-500 px-4 py-3 rounded-lg">
          {successMessage}
        </div>
      )}

      {/* Tabs */}
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="border-b border-gray-700 px-6">
          <div className="flex space-x-8 overflow-x-auto">
            {[
              { key: 'basic', label: 'Basic Info' },
              { key: 'financials', label: 'Financials' },
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
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Company Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={editedData.companyName ?? ipo.companyName}
                    onChange={(e) => handleFieldChange('companyName', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleSaveField('ipos', 'companyName', editedData.companyName ?? ipo.companyName)}
                    disabled={isSaving}
                    className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                  >
                    Save & Protect
                  </button>
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Status
                  </label>
                  <select
                    value={editedData.status ?? ipo.status}
                    onChange={(e) => handleFieldChange('status', e.target.value)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="UPCOMING">Upcoming</option>
                    <option value="OPEN">Open</option>
                    <option value="CLOSED">Closed</option>
                    <option value="LISTED">Listed</option>
                  </select>
                  <button
                    onClick={() => handleSaveField('ipos', 'status', editedData.status ?? ipo.status)}
                    disabled={isSaving}
                    className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                  >
                    Save & Protect
                  </button>
                </div>

                {/* Lot Size */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Lot Size
                  </label>
                  <input
                    type="number"
                    value={editedData.lotSize ?? ipo.lotSize ?? ''}
                    onChange={(e) => handleFieldChange('lotSize', e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleSaveField('ipos', 'lotSize', editedData.lotSize ?? ipo.lotSize)}
                    disabled={isSaving}
                    className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                  >
                    Save & Protect
                  </button>
                </div>

                {/* Price Range Min */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Price Range Min (₹)
                  </label>
                  <input
                    type="number"
                    value={editedData.priceRangeMin ?? ipo.priceRangeMin ?? ''}
                    onChange={(e) => handleFieldChange('priceRangeMin', e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => handleSaveField('ipos', 'priceRangeMin', editedData.priceRangeMin ?? ipo.priceRangeMin)}
                    disabled={isSaving}
                    className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                  >
                    Save & Protect
                  </button>
                </div>
              </div>

              <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">
                  <strong>Note:</strong> Clicking "Save & Protect" will update the field value and automatically protect it from scraper updates.
                </p>
              </div>
            </div>
          )}

          {/* Financials Tab */}
          {activeTab === 'financials' && (
            <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Financial Data</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Revenue FY2022 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Revenue FY2022 (₹ Cr)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.revenueFy2022 ?? financialData?.revenueFy2022 ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, revenueFy2022: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'revenueFy2022', editedFinancials.revenueFy2022 ?? financialData?.revenueFy2022)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* Revenue FY2023 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Revenue FY2023 (₹ Cr)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.revenueFy2023 ?? financialData?.revenueFy2023 ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, revenueFy2023: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'revenueFy2023', editedFinancials.revenueFy2023 ?? financialData?.revenueFy2023)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* Profit FY2022 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Profit FY2022 (₹ Cr)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.profitFy2022 ?? financialData?.profitFy2022 ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, profitFy2022: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'profitFy2022', editedFinancials.profitFy2022 ?? financialData?.profitFy2022)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* Profit FY2023 */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Profit FY2023 (₹ Cr)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.profitFy2023 ?? financialData?.profitFy2023 ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, profitFy2023: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'profitFy2023', editedFinancials.profitFy2023 ?? financialData?.profitFy2023)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* P/E Ratio */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">P/E Ratio</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.peRatio ?? financialData?.peRatio ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, peRatio: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'peRatio', editedFinancials.peRatio ?? financialData?.peRatio)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* ROE */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">ROE (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.roe ?? financialData?.roe ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, roe: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'roe', editedFinancials.roe ?? financialData?.roe)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* Debt to Equity */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Debt to Equity</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.debtToEquity ?? financialData?.debtToEquity ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, debtToEquity: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'debtToEquity', editedFinancials.debtToEquity ?? financialData?.debtToEquity)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>

                  {/* Net Worth */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Net Worth (₹ Cr)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={editedFinancials.netWorth ?? financialData?.netWorth ?? ''}
                      onChange={(e) => setEditedFinancials(prev => ({ ...prev, netWorth: e.target.value || null }))}
                      className="w-full px-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => handleSaveField('financialData', 'netWorth', editedFinancials.netWorth ?? financialData?.netWorth)}
                      disabled={isSaving}
                      className="mt-2 text-sm text-blue-500 hover:text-blue-400"
                    >
                      Save & Protect
                    </button>
                  </div>
                </div>

                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 mt-6">
                  <p className="text-sm text-gray-400">
                    <strong>Note:</strong> Financial data fields can be edited and protected individually. Click "Save & Protect" to update and auto-protect from scraper overwrites.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Subscriptions Tab */}
          {activeTab === 'subscriptions' && (
            <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-white">Subscription Data</h3>
                  {subscriptions && subscriptions.length > 0 && !isEditingSubscription && (
                    <button
                      onClick={handleStartEditSubscription}
                      disabled={isSaving}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      Edit Latest
                    </button>
                  )}
                </div>

                {subscriptions && subscriptions.length > 0 ? (
                  <div className="space-y-4">
                    {/* Edit Form for Latest Subscription */}
                    {isEditingSubscription && (
                      <div className="p-6 bg-gray-800 rounded-lg border-2 border-blue-500">
                        <div className="flex justify-between items-center mb-4">
                          <h4 className="text-sm font-semibold text-white">
                            Editing Latest Snapshot
                          </h4>
                          <span className="text-xs text-gray-400">
                            {new Date(subscriptions[0].timestamp).toLocaleString()}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                          {/* Total Subscription */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Overall Subscription (x)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.totalSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                totalSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 2.45"
                            />
                          </div>

                          {/* QIB Subscription */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              QIB Subscription (x)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.qibSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                qibSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 3.20"
                            />
                          </div>

                          {/* NII Subscription */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              NII Subscription (x)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.niiSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                niiSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 1.85"
                            />
                          </div>

                          {/* Retail Subscription */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Retail Subscription (x)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.retailSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                retailSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 2.10"
                            />
                          </div>

                          {/* Employee Subscription (Optional) */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Employee Subscription (x) <span className="text-gray-500">(Optional)</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.employeeSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                employeeSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 0.50"
                            />
                          </div>

                          {/* Others Subscription (Optional) */}
                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Others Subscription (x) <span className="text-gray-500">(Optional)</span>
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedSubscription.othersSubscription ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                othersSubscription: e.target.value || null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 1.00"
                            />
                          </div>

                          {/* Total Applications (Optional) */}
                          <div className="md:col-span-2">
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Total Applications <span className="text-gray-500">(Optional)</span>
                            </label>
                            <input
                              type="number"
                              min="0"
                              value={editedSubscription.totalApplications ?? ''}
                              onChange={(e) => setEditedSubscription(prev => ({
                                ...prev,
                                totalApplications: e.target.value ? Number(e.target.value) : null
                              }))}
                              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="e.g., 125000"
                            />
                          </div>
                        </div>

                        {/* Auto-Protect Toggle */}
                        <div className="flex items-center mb-4 p-3 bg-gray-900 rounded-lg">
                          <input
                            type="checkbox"
                            id="autoProtectSubscription"
                            checked={autoProtectSubscription}
                            onChange={(e) => setAutoProtectSubscription(e.target.checked)}
                            className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                          />
                          <label htmlFor="autoProtectSubscription" className="ml-2 text-sm text-gray-300">
                            Auto-Protect edited fields from scraper updates
                          </label>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                          <button
                            onClick={handleSaveSubscription}
                            disabled={isSaving}
                            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                          >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                          </button>
                          <button
                            onClick={handleCancelEditSubscription}
                            disabled={isSaving}
                            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>

                        <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
                          <p className="text-xs text-yellow-400">
                            <strong>Note:</strong> Changes greater than 500% will prompt a confirmation. Only the latest snapshot can be edited. Historical data is preserved.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Display Subscription Snapshots */}
                    {subscriptions.slice(0, 5).map((sub, index) => (
                      <div
                        key={sub.id}
                        className={`p-4 bg-gray-800 rounded-lg border ${index === 0 && !isEditingSubscription ? 'border-blue-500/50' : 'border-gray-700'}`}
                      >
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="text-sm font-semibold text-white">
                            Snapshot #{subscriptions.length - index}
                            {index === 0 && <span className="ml-2 text-xs text-blue-400">(Latest)</span>}
                          </h4>
                          <span className="text-xs text-gray-400">
                            {new Date(sub.timestamp).toLocaleString()}
                          </span>
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
                          {(sub.employeeSubscription || sub.othersSubscription || sub.totalApplications) && (
                            <>
                              {sub.employeeSubscription && (
                                <div>
                                  <div className="text-xs text-gray-400">Employee</div>
                                  <div className="text-sm font-medium text-white">{Number(sub.employeeSubscription).toFixed(2)}x</div>
                                </div>
                              )}
                              {sub.othersSubscription && (
                                <div>
                                  <div className="text-xs text-gray-400">Others</div>
                                  <div className="text-sm font-medium text-white">{Number(sub.othersSubscription).toFixed(2)}x</div>
                                </div>
                              )}
                              {sub.totalApplications && (
                                <div>
                                  <div className="text-xs text-gray-400">Total Apps</div>
                                  <div className="text-sm font-medium text-white">{sub.totalApplications.toLocaleString()}</div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                    {subscriptions.length > 5 && (
                      <p className="text-xs text-gray-400 text-center">
                        Showing latest 5 of {subscriptions.length} snapshots
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-sm">No subscription data available.</p>
                    <p className="text-xs mt-1">Subscription data will appear during IPO open period.</p>
                  </div>
                )}
              </div>
            </div>
          )}


          {/* GMP Tab */}
          {activeTab === 'gmp' && (
            <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-white">Grey Market Premium (GMP)</h3>
                  <button
                    onClick={handleOpenAddGMP}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    + Add New GMP Record
                  </button>
                </div>
                {gmpRecords && gmpRecords.length > 0 ? (
                  <div className="space-y-4">
                    {gmpRecords.slice(0, 10).map((gmp, index) => (
                      <div key={gmp.id} className="p-4 bg-gray-800 rounded-lg border border-gray-700">
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex items-center space-x-3">
                            <h4 className="text-sm font-semibold text-white">
                              ₹{gmp.gmp} Premium
                            </h4>
                          </div>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-gray-400">
                              {new Date(gmp.timestamp).toLocaleString()}
                            </span>
                            <button
                              onClick={() => handleOpenEditGMP(gmp)}
                              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteGMP(gmp.id)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                            >
                              Delete
                            </button>
                          </div>
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
                      <p className="text-xs text-gray-400 text-center">
                        Showing latest 10 of {gmpRecords.length} records
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-400">
                    <p className="text-sm">No GMP data available.</p>
                    <p className="text-xs mt-1">Click "Add New GMP Record" to create one.</p>
                  </div>
                )}

                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700 mt-6">
                  <p className="text-sm text-gray-400">
                    <strong>Note:</strong> GMP records can be added, edited, or deleted. All records are automatically protected from scraper overwrites unless you disable "Auto-Protect".
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Documents Tab */}
          {activeTab === 'documents' && (
            <div className="space-y-6">
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
                              <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded">
                                {doc.type}
                              </span>
                              <span className="text-xs px-2 py-1 bg-gray-700 text-gray-300 rounded">
                                {doc.mediaType}
                              </span>
                              {!doc.isActive && (
                                <span className="text-xs px-2 py-1 bg-red-500/20 text-red-400 rounded">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-400">
                              {doc.exchange && (
                                <div>
                                  <span className="font-medium">Exchange:</span> {doc.exchange}
                                </div>
                              )}
                              <div>
                                <span className="font-medium">Sequence:</span> #{doc.sequenceNumber}
                              </div>
                              {doc.fileSize && (
                                <div>
                                  <span className="font-medium">Size:</span> {(doc.fileSize / 1024 / 1024).toFixed(2)} MB
                                </div>
                              )}
                              <div>
                                <span className="font-medium">Uploaded:</span> {new Date(doc.uploadedAt).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 ml-4">
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors"
                            >
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
                    <p className="text-xs mt-1">IPO documents (DRHP, RHP, Prospectus) will be displayed here when available.</p>
                  </div>
                )}
              </div>

              <div className="bg-gray-900 p-4 rounded-lg border border-gray-700">
                <p className="text-sm text-gray-400">
                  <strong>Note:</strong> Documents are automatically scraped from NSE and BSE.
                  Document management features (upload, delete, edit) will be added in a future update.
                </p>
              </div>
            </div>
          )}

          {/* Protection Settings Tab */}
          {activeTab === 'protection' && (
            <div className="space-y-6">
              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">IPO-Level Lock</h3>
                    <p className="text-sm text-gray-400">
                      {ipo.scraperLocked
                        ? 'This IPO is locked. All scraper updates are blocked.'
                        : 'This IPO is unlocked. Scrapers can update non-protected fields.'}
                    </p>
                  </div>

                  <button
                    onClick={handleToggleIPOLock}
                    disabled={isSaving}
                    className={`px-6 py-3 font-semibold rounded-lg transition-colors ${
                      ipo.scraperLocked
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-green-600 hover:bg-green-700 text-white'
                    }`}
                  >
                    {isSaving ? 'Updating...' : ipo.scraperLocked ? 'Unlock IPO' : 'Lock IPO'}
                  </button>
                </div>

                {ipo.scraperLockNote && (
                  <div className="mt-4 p-3 bg-gray-800 rounded border border-gray-700">
                    <div className="text-xs text-gray-500 mb-1">Lock Note:</div>
                    <div className="text-sm text-gray-300">{ipo.scraperLockNote}</div>
                  </div>
                )}
              </div>

              <div className="bg-gray-900 p-6 rounded-lg border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Field-Level Protection</h3>
                <p className="text-sm text-gray-400 mb-4">
                  Protect individual fields from scraper updates. Protected fields will retain their manual values.
                </p>

                {isLoadingProtections ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Bulk Operations Bar */}
                    <div className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={selectAllFields}
                          className="text-xs text-blue-500 hover:text-blue-400"
                        >
                          Select All
                        </button>
                        <span className="text-gray-600">|</span>
                        <button
                          onClick={deselectAllFields}
                          className="text-xs text-blue-500 hover:text-blue-400"
                        >
                          Deselect All
                        </button>
                        {selectedFields.length > 0 && (
                          <span className="text-xs text-gray-400">
                            ({selectedFields.length} selected)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleBulkProtect(true)}
                          disabled={isSaving || selectedFields.length === 0}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Protect Selected
                        </button>
                        <button
                          onClick={() => handleBulkProtect(false)}
                          disabled={isSaving || selectedFields.length === 0}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Unprotect Selected
                        </button>
                      </div>
                    </div>

                    {/* Common IPO Fields */}
                    <div className="space-y-2">
                      <h4 className="text-sm font-semibold text-gray-300 mb-3">Basic Fields (ipos table)</h4>
                      {['companyName', 'status', 'lotSize', 'priceRangeMin', 'priceRangeMax', 'openDate', 'closeDate', 'listingDate', 'issueSize', 'faceValue'].map((fieldName) => {
                        const protection = protectedFields.find(
                          (p) => p.tableName === 'ipos' && p.fieldName === fieldName
                        );
                        const isProtected = protection?.isProtected || false;
                        const isAutoProtected = protection?.autoProtected || false;
                        const isSelected = selectedFields.includes(fieldName);

                        return (
                          <div
                            key={fieldName}
                            className={`flex items-center justify-between p-3 bg-gray-800 rounded border transition-colors ${
                              isSelected ? 'border-blue-500' : 'border-gray-700 hover:border-gray-600'
                            }`}
                          >
                            {/* Checkbox for bulk selection */}
                            <div className="flex items-center space-x-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleFieldSelection(fieldName)}
                                className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                              />
                              <div className="flex-1">
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-medium text-white">{fieldName}</span>
                                  {isAutoProtected && (
                                    <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded">
                                      Auto-protected
                                    </span>
                                  )}
                                </div>
                                {protection?.editNote && (
                                  <p className="text-xs text-gray-500 mt-1">{protection.editNote}</p>
                                )}
                              </div>
                            </div>

                            {/* Individual toggle switch */}
                            <button
                              onClick={() => handleToggleFieldProtection('ipos', fieldName, isProtected)}
                              disabled={isSaving}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                isProtected ? 'bg-green-600' : 'bg-gray-600'
                              } ${isSaving ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  isProtected ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Show message if no protections yet */}
                    {protectedFields.length === 0 && !isLoadingProtections && (
                      <div className="text-center py-8 text-gray-400">
                        <p className="text-sm">No field protections configured yet.</p>
                        <p className="text-xs mt-1">Use the toggles above to protect fields or edit fields in the Basic Info tab.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GMP Modal */}
      {showGMPModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-lg border border-gray-700 p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-semibold text-white">
                {editingGMP ? 'Edit GMP Record' : 'Add New GMP Record'}
              </h3>
              <button
                onClick={handleCloseGMPModal}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* GMP Price */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  GMP Price (₹) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={gmpFormData.gmpPrice}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, gmpPrice: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter GMP price in rupees"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">Grey market premium amount in rupees</p>
              </div>

              {/* Expected Listing Price */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Expected Listing Price (₹)
                </label>
                <input
                  type="number"
                  step="1"
                  value={gmpFormData.estimatedListingPrice}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, estimatedListingPrice: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Expected listing price (Issue Price + GMP)"
                />
                <p className="text-xs text-gray-400 mt-1">Expected listing price including GMP premium</p>
              </div>

              {/* Sauda Details */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Sauda Details / Trading Info
                </label>
                <textarea
                  value={gmpFormData.subject}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, subject: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Trading information, sauda details, or notes"
                  rows={3}
                />
                <p className="text-xs text-gray-400 mt-1">Optional: Trading information or additional notes</p>
              </div>

              {/* Source */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Source <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={gmpFormData.source}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, source: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Manual Entry, Market Source, Chittorgarh"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">Source of this GMP data (required)</p>
              </div>

              {/* Recorded At */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Recorded At
                </label>
                <input
                  type="datetime-local"
                  value={gmpFormData.recordedAt}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, recordedAt: e.target.value }))}
                  className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Date and time when this GMP was recorded</p>
              </div>

              {/* Auto-Protect Toggle */}
              <div className="flex items-center space-x-3 p-4 bg-gray-800 rounded-lg border border-gray-700">
                <input
                  type="checkbox"
                  id="autoProtectGMP"
                  checked={gmpFormData.autoProtect}
                  onChange={(e) => setGmpFormData(prev => ({ ...prev, autoProtect: e.target.checked }))}
                  className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                />
                <label htmlFor="autoProtectGMP" className="text-sm text-gray-300 cursor-pointer">
                  Auto-Protect this record from scraper overwrites
                </label>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-700">
                <button
                  onClick={handleCloseGMPModal}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveGMP}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : editingGMP ? 'Update Record' : 'Create Record'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
