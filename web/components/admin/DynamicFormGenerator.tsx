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

interface DynamicFormGeneratorProps {
  tableMetadata: TableMetadata;
  initialData?: Record<string, any>;
  onSubmit: (data: Record<string, any>) => Promise<void>;
  onCancel?: () => void;
  mode?: 'create' | 'edit';
}

interface FieldComponentProps {
  column: ColumnMetadata;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  disabled?: boolean;
}

/**
 * Renders an appropriate input component based on column type
 */
function FieldComponent({ column, value, onChange, error, disabled }: FieldComponentProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const newValue = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
    onChange(newValue);
  };

  switch (column.fieldType) {
    case 'hidden':
      return <input type="hidden" value={value || ''} />;

    case 'text':
      return (
        <div className="space-y-1">
          <input
            type="text"
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            maxLength={column.maxLength}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
            placeholder={column.isNullable ? '(Optional)' : ''}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
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
          <input
            type="number"
            value={value || ''}
            onChange={handleChange}
            disabled={disabled}
            min={column.validation?.min}
            max={column.validation?.max}
            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
              error ? 'border-red-500' : 'border-gray-300'
            } ${disabled ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
            placeholder={column.isNullable ? '(Optional)' : ''}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
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
  mode = 'edit'
}: DynamicFormGeneratorProps) {
  const [formData, setFormData] = useState<Record<string, any>>(initialData);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    setFormData(initialData);
    setIsDirty(false);
    setErrors({});
  }, [initialData]);

  const handleFieldChange = (fieldName: string, value: any) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
    setIsDirty(true);

    // Clear error for this field
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[fieldName];
        return newErrors;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: Record<string, string> = {};
    let hasErrors = false;

    for (const column of tableMetadata.columns) {
      if (!isFieldEditable(column)) continue;

      const validation = validateField(column, formData[column.name]);
      if (!validation.valid) {
        newErrors[column.name] = validation.error!;
        hasErrors = true;
      }
    }

    if (hasErrors) {
      setErrors(newErrors);
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
    setIsDirty(false);
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

              return (
                <div key={column.name} className={column.fieldType === 'textarea' || column.fieldType === 'json' ? 'md:col-span-2' : ''}>
                  {column.fieldType !== 'hidden' && (
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {column.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      {!column.isNullable && <span className="text-red-500 ml-1">*</span>}
                    </label>
                  )}
                  <FieldComponent
                    column={column}
                    value={formData[column.name]}
                    onChange={(value) => handleFieldChange(column.name, value)}
                    error={errors[column.name]}
                    disabled={isSubmitting}
                  />
                  {column.fieldType !== 'hidden' && column.dataType && (
                    <p className="text-xs text-gray-500 mt-1">
                      Type: {column.dataType}
                      {column.maxLength && ` (max ${column.maxLength} chars)`}
                      {column.precision && ` (${column.precision} digits)`}
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