/**
 * Dynamic Form Generator for Self-Extending Admin System
 *
 * This component generates forms dynamically based on table schema metadata.
 * It maps column types to appropriate input components and handles validation.
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

'use client';

import React, { useState, useEffect } from 'react';
import type { ColumnMetadata, TableMetadata } from '@/lib/admin/schema-introspector';
import { validateField, isFieldEditable, groupColumnsByCategory } from '@/lib/admin/schema-introspector';
import { getFieldLabel } from '@/lib/admin/field-labels';
import { validateCustomField } from '@/lib/admin/dynamic-validation-rules';
import { FieldTooltip } from './TooltipSystem';

interface DynamicFormGeneratorProps {
  tableMetadata: TableMetadata;
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
  mode?: 'create' | 'edit';
  // Field Protection Integration (Phase 1 Consolidation)
  enableProtection?: boolean;
  ipoId?: string;
  protectedFields?: Set<string>;
  onProtectField?: (fieldName: string, isProtected: boolean) => Promise<void>;
}

interface FieldComponentProps {
  column: ColumnMetadata;
  value: any;
  onChange: (value: any) => void;
  onBlur?: (value: any) => void; // Added for inline validation
  error?: string;
  warning?: string; // Added for validation warnings
  disabled?: boolean;
  tableName: string; // Added for field label lookup
}

/**
 * Renders an appropriate input component based on column type
 */
function FieldComponent({ column, value, onChange, onBlur, error, warning, disabled, tableName }: FieldComponentProps) {
  const fieldConfig = getFieldLabel(tableName, column.name);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const newValue = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    onChange(newValue);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    if (onBlur) {
      const blurValue = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
      onBlur(blurValue);
    }
  };

  switch (column.fieldType) {
    case 'hidden':
      return <input type="hidden" value={value || ''} />;

    case 'text':
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {fieldConfig.unit && fieldConfig.unit.startsWith('₹') && (
              <span className="text-gray-600 font-medium">{fieldConfig.unit}</span>
            )}
            <input
              type="text"
              value={value || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={disabled}
              maxLength={column.maxLength}
              className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                error ? 'border-red-500' : warning ? 'border-yellow-400' : 'border-gray-300'
              } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
              placeholder={fieldConfig.placeholder || (column.isNullable ? '(Optional)' : '')}
            />
            {fieldConfig.unit && !fieldConfig.unit.startsWith('₹') && (
              <span className="text-gray-600 text-sm">{fieldConfig.unit}</span>
            )}
          </div>
          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          {!error && warning && (
            <p className="text-sm text-yellow-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {warning}
            </p>
          )}
        </div>
      );

    case 'textarea':
      return (
        <div className="space-y-1">
          <textarea
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            rows={4}
            maxLength={column.maxLength}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
            placeholder={column.isNullable ? '(Optional)' : ''}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'number':
      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {fieldConfig.unit && fieldConfig.unit.startsWith('₹') && (
              <span className="text-gray-600 font-medium">{fieldConfig.unit}</span>
            )}
            <input
              type="number"
              value={value || ''}
              onChange={handleChange}
              onBlur={handleBlur}
              disabled={disabled}
              min={column.validation?.min}
              max={column.validation?.max}
              className={`flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                error ? 'border-red-500' : warning ? 'border-yellow-400' : 'border-gray-300'
              } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
              placeholder={fieldConfig.placeholder || (column.isNullable ? '(Optional)' : '')}
            />
            {fieldConfig.unit && !fieldConfig.unit.startsWith('₹') && (
              <span className="text-gray-600 text-sm">{fieldConfig.unit}</span>
            )}
          </div>
          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          {!error && warning && (
            <p className="text-sm text-yellow-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {warning}
            </p>
          )}
        </div>
      );

    case 'decimal':
      return (
        <div className="space-y-1">
          <input
            type="number"
            step={column.scale ? `0.${'0'.repeat(column.scale - 1)}1` : '0.01'}
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
            placeholder={column.isNullable ? '(Optional)' : ''}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'date':
      return (
        <div className="space-y-1">
          <input
            type="date"
            value={value ? new Date(value).toISOString().split('T')[0] : ''}
            onChange={handleChange}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'datetime':
      return (
        <div className="space-y-1">
          <input
            type="datetime-local"
            value={value ? new Date(value).toISOString().slice(0, -1) : ''}
            onChange={handleChange}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'boolean':
      return (
        <div className="space-y-1">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={value || false}
              onChange={handleChange}
              disabled={disabled}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              {value ? 'Yes' : 'No'}
            </span>
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'select':
      return (
        <div className="space-y-1">
          <select
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
          >
            <option value="">-- Select --</option>
            {column.enumValues?.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'json':
      return (
        <div className="space-y-1">
          <textarea
            value={typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                onChange(parsed);
              } catch {
                onChange(e.target.value);
              }
            }}
            disabled={disabled}
            rows={6}
            className={`w-full px-3 py-2 border rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
            placeholder='{"key": "value"}'
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    case 'uuid':
      return (
        <div className="space-y-1">
          <input
            type="text"
            value={value || ''}
            onChange={handleChange}
            disabled={disabled || true} // UUIDs are typically auto-generated
            pattern="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100 cursor-not-allowed font-mono text-sm"
            placeholder="Auto-generated UUID"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );

    default:
      return (
        <div className="space-y-1">
          <input
            type="text"
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      );
  }
}

/**
 * Main Dynamic Form Generator Component
 */
export function DynamicFormGenerator({
  tableMetadata,
  initialData = {},
  onSubmit,
  onCancel,
  mode = 'edit',
  enableProtection = false,
  ipoId,
  protectedFields = new Set(),
  onProtectField
}: DynamicFormGeneratorProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [protectingField, setProtectingField] = useState<string | null>(null);

  useEffect(() => {
    setFormData(initialData);
    setIsDirty(false);
    setErrors({});
    setWarnings({});
  }, [initialData]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    setIsDirty(true);

    // Clear error and warning for this field
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
    if (warnings[fieldName]) {
      setWarnings(prev => {
        const newWarnings = { ...prev };
        delete newWarnings[fieldName];
        return newWarnings;
      });
    }
  };

  const handleFieldBlur = (fieldName: string, value: any) => {
    // Run custom validation on blur
    const validationResult = validateCustomField({
      tableName: tableMetadata.name,
      fieldName,
      value,
      record: formData,
    });

    // Set error or warning based on validation result
    if (!validationResult.valid && validationResult.error) {
      setErrors(prev => ({ ...prev, [fieldName]: validationResult.error! }));
    } else if (validationResult.warning) {
      setWarnings(prev => ({ ...prev, [fieldName]: validationResult.warning! }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields (both schema and custom validation)
    const newErrors: Record<string, string> = {};
    const newWarnings: Record<string, string> = {};
    let hasErrors = false;

    for (const column of tableMetadata.columns) {
      if (!isFieldEditable(column)) continue;

      const fieldValue = formData[column.name];

      // 1. Schema validation (type, required, etc.)
      const schemaValidation = validateField(column, fieldValue);
      if (!schemaValidation.valid) {
        newErrors[column.name] = schemaValidation.error!;
        hasErrors = true;
        continue; // Skip custom validation if schema validation fails
      }

      // 2. Custom business logic validation
      const customValidation = validateCustomField({
        tableName: tableMetadata.name,
        fieldName: column.name,
        value: fieldValue,
        record: formData,
      });

      if (!customValidation.valid && customValidation.error) {
        newErrors[column.name] = customValidation.error;
        hasErrors = true;
      } else if (customValidation.warning) {
        newWarnings[column.name] = customValidation.warning;
      }
    }

    // Update errors and warnings
    setErrors(newErrors);
    setWarnings(newWarnings);

    // Block submission if there are errors (warnings are non-blocking)
    if (hasErrors) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(formData);
      setIsDirty(false);
    } catch (error) {
      console.error('Form submission error:', error);
      // Handle submission error
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData(initialData);
    setErrors({});
    setWarnings({});
    setIsDirty(false);
  };

  const handleProtectionToggle = async (fieldName: string) => {
    if (!onProtectField || !ipoId) return;

    try {
      setProtectingField(fieldName);
      const isCurrentlyProtected = protectedFields.has(fieldName);
      await onProtectField(fieldName, !isCurrentlyProtected);
    } catch (error) {
      console.error('Failed to toggle field protection:', error);
      alert('Failed to update field protection');
    } finally {
      setProtectingField(null);
    }
  };

  // Group columns by category for organized display
  const columnGroups = groupColumnsByCategory(tableMetadata.columns);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Table Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold text-blue-900">
          {mode === 'create' ? 'Create New' : 'Edit'} {tableMetadata.name}
        </h3>
        <p className="text-sm text-blue-700 mt-1">
          This form is auto-generated from the database schema.
        </p>
      </div>

      {/* Form Fields by Category */}
      {Object.entries(columnGroups).map(([category, columns]) => (
        <div key={category} className="bg-white border border-gray-200 rounded-lg p-6">
          <h4 className="text-lg font-semibold text-gray-900 mb-4">{category}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {columns.map(column => {
              if (!isFieldEditable(column) && column.fieldType !== 'hidden') {
                return null;
              }

              const isProtected = protectedFields.has(column.name);
              const isProtecting = protectingField === column.name;

              const fieldConfig = getFieldLabel(tableMetadata.name, column.name);

              return (
                <div key={column.name} className={column.fieldType === 'textarea' || column.fieldType === 'json' ? 'md:col-span-2' : ''}>
                  {column.fieldType !== 'hidden' && (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <label className="block text-sm font-medium text-gray-700">
                            {fieldConfig.label}
                            {!column.isNullable && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          {/* Enhanced tooltip with regulatory references */}
                          <FieldTooltip
                            tableName={tableMetadata.name}
                            fieldName={column.name}
                            position="right"
                            trigger="hover"
                          />
                          {/* Fallback to simple tooltip if no enhanced content available */}
                          {!fieldConfig.tooltip && fieldConfig.description && (
                            <span
                              className="inline-flex items-center text-gray-400 hover:text-gray-600 cursor-help"
                              title={fieldConfig.description}
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                          {isProtected && (
                            <span className="ml-2 inline-flex items-center text-xs text-yellow-600">
                              <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                              </svg>
                              Protected
                            </span>
                          )}
                        </div>
                        {enableProtection && onProtectField && mode === 'edit' && (
                          <button
                            type="button"
                            onClick={() => handleProtectionToggle(column.name)}
                            disabled={isProtecting || isSubmitting}
                            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                              isProtected
                                ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={isProtected ? 'Click to unprotect field' : 'Click to protect field from scraper updates'}
                          >
                            {isProtecting ? '...' : isProtected ? '🔓 Unprotect' : '🔒 Protect'}
                          </button>
                        )}
                      </div>
                      {fieldConfig.description && (
                        <p className="text-xs text-gray-500 mt-0.5 mb-1">
                          {fieldConfig.description}
                        </p>
                      )}
                    </>
                  )}
                  <FieldComponent
                    column={column}
                    value={formData[column.name]}
                    onChange={(value) => handleFieldChange(column.name, value)}
                    onBlur={(value) => handleFieldBlur(column.name, value)}
                    error={errors[column.name]}
                    warning={warnings[column.name]}
                    disabled={isSubmitting}
                    tableName={tableMetadata.name}
                  />
                  {column.fieldType !== 'hidden' && fieldConfig.helpText && (
                    <p className="text-xs text-gray-500 mt-1">
                      {fieldConfig.helpText}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Form Actions */}
      <div className="flex justify-between items-center bg-gray-50 rounded-lg p-4">
        <div className="text-sm text-gray-600">
          {isDirty && '• Unsaved changes'}
        </div>
        <div className="space-x-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="px-6 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting}
              className="px-6 py-2 border border-gray-300 text-gray-700 bg-white rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reset
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting || (!isDirty && mode === 'edit')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  );
}