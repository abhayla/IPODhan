/**
 * Admin Panel - Anchor Investors Management (Story 11.10)
 *
 * Manual data entry form for anchor investor allocation details
 */

'use client';

import { useState, useEffect } from 'react';
import { useAdminAuth } from '@/lib/context/AdminAuthContext';
import { adminGet, adminPost, adminDelete } from '@/lib/admin/admin-api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Plus, Trash2, Save, RotateCcw, Search, Anchor, Lock, Calendar } from 'lucide-react';
import type { IPO } from '@/lib/db/types';
import type { IndividualInvestor } from '@/lib/db';

// ==================== TYPES ====================

interface AnchorFormData {
  ipoId: string;
  bidDate: string;
  totalSharesOffered: number;
  totalAmountRaised: string;
  anchorInvestorsCount: number;
  investorList: IndividualInvestor[];
}

const INVESTOR_TYPES = [
  'Mutual Fund',
  'FII',
  'Insurance',
  'Bank',
  'HNI',
  'Corporate',
  'Other',
] as const;

// ==================== COMPONENT ====================

export default function AnchorInvestorsAdminPage() {
  const { token } = useAdminAuth();

  // IPO Selection State
  const [ipos, setIpos] = useState<IPO[]>([]);
  const [selectedIPO, setSelectedIPO] = useState<IPO | null>(null);
  const [ipoSearch, setIpoSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Form State
  const [formData, setFormData] = useState<AnchorFormData>({
    ipoId: '',
    bidDate: new Date().toISOString().split('T')[0],
    totalSharesOffered: 0,
    totalAmountRaised: '',
    anchorInvestorsCount: 0,
    investorList: [],
  });

  // UI State
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch IPOs on component mount
  useEffect(() => {
    fetchIPOs();
  }, []);

  // Fetch existing anchor data when IPO is selected
  useEffect(() => {
    if (selectedIPO) {
      fetchExistingAnchorData(selectedIPO.id);
    }
  }, [selectedIPO]);

  // ==================== API FUNCTIONS ====================

  const fetchIPOs = async () => {
    try {
      setIsLoading(true);
      const response = await adminGet('/api/admin/ipos?limit=100');
      setIpos(response.data || []);
    } catch (error) {
      console.error('Failed to fetch IPOs:', error);
      setErrorMessage('Failed to load IPOs. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchExistingAnchorData = async (ipoId: string) => {
    try {
      setIsLoading(true);
      const response = await adminGet(`/api/admin/anchor-investors?ipoId=${ipoId}`);

      if (response.data) {
        // Populate form with existing data
        setFormData({
          ipoId: response.data.ipoId,
          bidDate: response.data.bidDate,
          totalSharesOffered: response.data.totalSharesOffered,
          totalAmountRaised: response.data.totalAmountRaised,
          anchorInvestorsCount: response.data.anchorInvestorsCount,
          investorList: response.data.investorList || [],
        });
        setSuccessMessage('Loaded existing anchor data');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        // No existing data - reset to defaults
        setFormData({
          ipoId: ipoId,
          bidDate: new Date().toISOString().split('T')[0],
          totalSharesOffered: 0,
          totalAmountRaised: '',
          anchorInvestorsCount: 0,
          investorList: [],
        });
      }
    } catch (error) {
      console.error('Failed to fetch anchor data:', error);
      // Not an error - might be new entry
      setFormData({
        ipoId: ipoId,
        bidDate: new Date().toISOString().split('T')[0],
        totalSharesOffered: 0,
        totalAmountRaised: '',
        anchorInvestorsCount: 0,
        investorList: [],
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ==================== FORM HANDLERS ====================

  const handleIPOSelect = (ipo: IPO) => {
    setSelectedIPO(ipo);
    setErrors({});
    setSuccessMessage('');
    setErrorMessage('');
  };

  const handleFormChange = (field: keyof AnchorFormData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const handleAddInvestor = () => {
    const newInvestor: IndividualInvestor = {
      name: '',
      type: 'Mutual Fund',
      shares: 0,
      amount: 0,
      percentOfIssue: 0,
    };

    setFormData((prev) => ({
      ...prev,
      investorList: [...prev.investorList, newInvestor],
    }));
  };

  const handleRemoveInvestor = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      investorList: prev.investorList.filter((_, i) => i !== index),
    }));
  };

  const handleInvestorChange = (
    index: number,
    field: keyof IndividualInvestor,
    value: any
  ) => {
    setFormData((prev) => {
      const updatedList = [...prev.investorList];
      updatedList[index] = { ...updatedList[index], [field]: value };
      return { ...prev, investorList: updatedList };
    });
  };

  const handleClearForm = () => {
    setFormData({
      ipoId: selectedIPO?.id || '',
      bidDate: new Date().toISOString().split('T')[0],
      totalSharesOffered: 0,
      totalAmountRaised: '',
      anchorInvestorsCount: 0,
      investorList: [],
    });
    setErrors({});
    setSuccessMessage('');
    setErrorMessage('');
  };

  const handleDeleteAnchorData = async () => {
    if (!selectedIPO) return;

    if (!confirm('Are you sure you want to delete this anchor investor data?')) {
      return;
    }

    try {
      setIsSaving(true);
      await adminDelete(`/api/admin/anchor-investors?ipoId=${selectedIPO.id}`);
      setSuccessMessage('Anchor data deleted successfully');
      handleClearForm();
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      console.error('Failed to delete anchor data:', error);
      setErrorMessage('Failed to delete anchor data. Please try again.');
      setTimeout(() => setErrorMessage(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== VALIDATION ====================

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.ipoId) {
      newErrors.ipoId = 'Please select an IPO';
    }

    if (!formData.bidDate) {
      newErrors.bidDate = 'Bid date is required';
    }

    if (formData.totalSharesOffered <= 0) {
      newErrors.totalSharesOffered = 'Total shares must be greater than 0';
    }

    if (!formData.totalAmountRaised || parseFloat(formData.totalAmountRaised) < 0) {
      newErrors.totalAmountRaised = 'Total amount must be a valid positive number';
    }

    if (formData.anchorInvestorsCount < 0) {
      newErrors.anchorInvestorsCount = 'Investor count cannot be negative';
    }

    // Validate investor list
    formData.investorList.forEach((investor, index) => {
      if (!investor.name.trim()) {
        newErrors[`investor_${index}_name`] = 'Investor name is required';
      }
      if (investor.shares <= 0) {
        newErrors[`investor_${index}_shares`] = 'Shares must be greater than 0';
      }
      if (investor.amount < 0) {
        newErrors[`investor_${index}_amount`] = 'Amount cannot be negative';
      }
    });

    // Validate total shares allocation
    const totalAllocated = formData.investorList.reduce((sum, inv) => sum + inv.shares, 0);
    if (totalAllocated > formData.totalSharesOffered) {
      newErrors.totalSharesOffered = `Total allocated shares (${totalAllocated.toLocaleString()}) exceed total shares offered`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ==================== SAVE HANDLER ====================

  const handleSave = async () => {
    if (!validateForm()) {
      setErrorMessage('Please fix validation errors before saving');
      setTimeout(() => setErrorMessage(''), 5000);
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage('');

      await adminPost('/api/admin/anchor-investors', formData);

      setSuccessMessage('Anchor data saved successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error: any) {
      console.error('Failed to save anchor data:', error);
      setErrorMessage(
        error.response?.data?.error?.message || 'Failed to save anchor data. Please try again.'
      );
      setTimeout(() => setErrorMessage(''), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== COMPUTED VALUES ====================

  const filteredIPOs = ipos.filter((ipo) => {
    const matchesSearch =
      ipo.companyName.toLowerCase().includes(ipoSearch.toLowerCase()) ||
      ipo.slug.toLowerCase().includes(ipoSearch.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || ipo.status.toLowerCase() === statusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  const calculateLockInDates = () => {
    if (!formData.bidDate) return { lockIn50: 'N/A', lockIn90: 'N/A' };

    const bid = new Date(formData.bidDate);
    const lockIn50 = new Date(bid);
    lockIn50.setDate(lockIn50.getDate() + 30);

    const lockIn90 = new Date(bid);
    lockIn90.setDate(lockIn90.getDate() + 90);

    const formatDate = (date: Date) =>
      date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    return {
      lockIn50: formatDate(lockIn50),
      lockIn90: formatDate(lockIn90),
    };
  };

  const lockInDates = calculateLockInDates();

  // ==================== RENDER ====================

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2 flex items-center gap-3">
          <Anchor className="h-8 w-8 text-primary" />
          Anchor Investors Management
        </h1>
        <p className="text-muted-foreground">
          Manually enter anchor investor allocation details for IPOs
        </p>
      </div>

      {/* Messages */}
      {successMessage && (
        <Alert className="mb-6 border-green-500 bg-green-50 text-green-800">
          {successMessage}
        </Alert>
      )}

      {errorMessage && (
        <Alert className="mb-6 border-red-500 bg-red-50 text-red-800">{errorMessage}</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - IPO Selection */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5" />
                Select IPO
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Search Bar */}
              <div className="mb-4">
                <Label htmlFor="ipo-search">Search IPO</Label>
                <Input
                  id="ipo-search"
                  type="text"
                  placeholder="Company name or slug..."
                  value={ipoSearch}
                  onChange={(e) => setIpoSearch(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* Status Filter */}
              <div className="mb-4">
                <Label htmlFor="status-filter">Filter by Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger id="status-filter" className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="UPCOMING">Upcoming</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                    <SelectItem value="LISTED">Listed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* IPO List */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {isLoading ? (
                  <p className="text-sm text-muted-foreground">Loading IPOs...</p>
                ) : filteredIPOs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No IPOs found</p>
                ) : (
                  filteredIPOs.map((ipo) => (
                    <button
                      key={ipo.id}
                      onClick={() => handleIPOSelect(ipo)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        selectedIPO?.id === ipo.id
                          ? 'border-primary bg-primary/10'
                          : 'border-gray-200 hover:border-primary/50'
                      }`}
                    >
                      <p className="font-medium text-sm">{ipo.companyName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {ipo.status} • {ipo.segment || 'N/A'}
                      </p>
                    </button>
                  ))
                )}
              </div>

              {errors.ipoId && (
                <p className="text-sm text-red-600 mt-2">{errors.ipoId}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Anchor Investor Details</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedIPO ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Anchor className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Please select an IPO to enter anchor investor details</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Aggregate Data Fields */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {/* Bid Date */}
                    <div>
                      <Label htmlFor="bid-date">
                        Bid Date <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="bid-date"
                        type="date"
                        value={formData.bidDate}
                        onChange={(e) => handleFormChange('bidDate', e.target.value)}
                        className="mt-1"
                      />
                      {errors.bidDate && (
                        <p className="text-sm text-red-600 mt-1">{errors.bidDate}</p>
                      )}
                    </div>

                    {/* Total Shares Offered */}
                    <div>
                      <Label htmlFor="total-shares">
                        Total Shares Offered <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="total-shares"
                        type="number"
                        min="0"
                        value={formData.totalSharesOffered || ''}
                        onChange={(e) =>
                          handleFormChange('totalSharesOffered', parseInt(e.target.value) || 0)
                        }
                        className="mt-1"
                      />
                      {errors.totalSharesOffered && (
                        <p className="text-sm text-red-600 mt-1">{errors.totalSharesOffered}</p>
                      )}
                    </div>

                    {/* Total Amount Raised */}
                    <div>
                      <Label htmlFor="total-amount">
                        Total Amount Raised (₹ Crores) <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="total-amount"
                        type="text"
                        placeholder="250.00"
                        value={formData.totalAmountRaised}
                        onChange={(e) => handleFormChange('totalAmountRaised', e.target.value)}
                        className="mt-1"
                      />
                      {errors.totalAmountRaised && (
                        <p className="text-sm text-red-600 mt-1">{errors.totalAmountRaised}</p>
                      )}
                    </div>

                    {/* Anchor Investors Count */}
                    <div>
                      <Label htmlFor="investor-count">
                        Total Investors <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="investor-count"
                        type="number"
                        min="0"
                        value={formData.anchorInvestorsCount || ''}
                        onChange={(e) =>
                          handleFormChange('anchorInvestorsCount', parseInt(e.target.value) || 0)
                        }
                        className="mt-1"
                      />
                      {errors.anchorInvestorsCount && (
                        <p className="text-sm text-red-600 mt-1">{errors.anchorInvestorsCount}</p>
                      )}
                    </div>
                  </div>

                  {/* Lock-in Dates (Auto-calculated, Display-only) */}
                  <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
                    <div className="flex items-start gap-3">
                      <Lock className="h-5 w-5 mt-0.5 text-blue-600 dark:text-blue-400" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground mb-3">
                          Lock-in Period (Auto-calculated)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              50% Lock-in Expires (30 days)
                            </p>
                            <p className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              {lockInDates.lockIn50}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              Remaining 50% Lock-in Expires (90 days)
                            </p>
                            <p className="text-sm font-medium text-foreground flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              {lockInDates.lockIn90}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Investor List Section */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-base font-semibold">
                        Individual Investor Allocations (Optional)
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddInvestor}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Investor
                      </Button>
                    </div>

                    {formData.investorList.length === 0 ? (
                      <div className="p-6 border border-dashed rounded-lg text-center text-muted-foreground">
                        <p className="text-sm">
                          No individual investors added yet. Click &quot;Add Investor&quot; to
                          enter details.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {formData.investorList.map((investor, index) => (
                          <div
                            key={index}
                            className="p-4 border rounded-lg bg-muted/30 relative"
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveInvestor(index)}
                              className="absolute top-2 right-2"
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>

                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 pr-12">
                              {/* Name */}
                              <div>
                                <Label htmlFor={`investor-${index}-name`} className="text-xs">
                                  Name <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id={`investor-${index}-name`}
                                  type="text"
                                  value={investor.name}
                                  onChange={(e) =>
                                    handleInvestorChange(index, 'name', e.target.value)
                                  }
                                  className="mt-1"
                                />
                                {errors[`investor_${index}_name`] && (
                                  <p className="text-xs text-red-600 mt-1">
                                    {errors[`investor_${index}_name`]}
                                  </p>
                                )}
                              </div>

                              {/* Type */}
                              <div>
                                <Label htmlFor={`investor-${index}-type`} className="text-xs">
                                  Type
                                </Label>
                                <Select
                                  value={investor.type}
                                  onValueChange={(value) =>
                                    handleInvestorChange(index, 'type', value)
                                  }
                                >
                                  <SelectTrigger id={`investor-${index}-type`} className="mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {INVESTOR_TYPES.map((type) => (
                                      <SelectItem key={type} value={type}>
                                        {type}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              {/* Shares */}
                              <div>
                                <Label htmlFor={`investor-${index}-shares`} className="text-xs">
                                  Shares <span className="text-red-500">*</span>
                                </Label>
                                <Input
                                  id={`investor-${index}-shares`}
                                  type="number"
                                  min="0"
                                  value={investor.shares || ''}
                                  onChange={(e) =>
                                    handleInvestorChange(
                                      index,
                                      'shares',
                                      parseInt(e.target.value) || 0
                                    )
                                  }
                                  className="mt-1"
                                />
                                {errors[`investor_${index}_shares`] && (
                                  <p className="text-xs text-red-600 mt-1">
                                    {errors[`investor_${index}_shares`]}
                                  </p>
                                )}
                              </div>

                              {/* Amount */}
                              <div>
                                <Label htmlFor={`investor-${index}-amount`} className="text-xs">
                                  Amount (₹ Cr)
                                </Label>
                                <Input
                                  id={`investor-${index}-amount`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={investor.amount || ''}
                                  onChange={(e) =>
                                    handleInvestorChange(
                                      index,
                                      'amount',
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="mt-1"
                                />
                                {errors[`investor_${index}_amount`] && (
                                  <p className="text-xs text-red-600 mt-1">
                                    {errors[`investor_${index}_amount`]}
                                  </p>
                                )}
                              </div>

                              {/* % of Issue */}
                              <div>
                                <Label htmlFor={`investor-${index}-percent`} className="text-xs">
                                  % of Issue
                                </Label>
                                <Input
                                  id={`investor-${index}-percent`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={investor.percentOfIssue || ''}
                                  onChange={(e) =>
                                    handleInvestorChange(
                                      index,
                                      'percentOfIssue',
                                      parseFloat(e.target.value) || 0
                                    )
                                  }
                                  className="mt-1"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Form Actions */}
                  <div className="flex flex-wrap gap-3 pt-4 border-t">
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={isSaving || !selectedIPO}
                      className="flex-1 sm:flex-initial"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isSaving ? 'Saving...' : 'Save Data'}
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleClearForm}
                      disabled={isSaving}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Clear Form
                    </Button>

                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDeleteAnchorData}
                      disabled={isSaving || !selectedIPO}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Data
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
