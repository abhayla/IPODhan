/**
 * Schema Introspector for Self-Extending Admin System
 *
 * This utility reads the Drizzle schema at runtime and generates metadata
 * for dynamic form generation. It extracts table information, column types,
 * enums, relations, and validation rules.
 *
 * Part of Week 2 Admin Enhancement (Phase 6)
 */

import * as schema from '@ipodhan/shared/db/schema';
import { PgTable, PgColumn } from 'drizzle-orm/pg-core';
import { getTableName, getTableColumns, isTable } from 'drizzle-orm';

export interface ColumnMetadata {
  name: string;
  type: string;
  dataType: string;
  isPrimary: boolean;
  isUnique: boolean;
  isNullable: boolean;
  hasDefault: boolean;
  defaultValue?: any;
  enumValues?: string[];
  maxLength?: number;
  precision?: number;
  scale?: number;
  isRelation?: boolean;
  relationTo?: string;
  fieldType: FormFieldType;
  validation?: FieldValidation;
}

export interface TableMetadata {
  name: string;
  columns: ColumnMetadata[];
  primaryKey?: string;
  relations: RelationMetadata[];
  indexes: string[];
}

export interface RelationMetadata {
  field: string;
  reference: string;
  type: 'one' | 'many';
}

export interface FieldValidation {
  required: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  custom?: (value: any) => boolean;
}

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'json'
  | 'uuid'
  | 'file'
  | 'hidden';

/**
 * Maps Drizzle column types to appropriate form field types
 */
function mapColumnTypeToFieldType(column: any): FormFieldType {
  const dataType = column.dataType?.toLowerCase() || '';
  const columnType = column.columnType?.toLowerCase() || '';

  // Check for enums first (they should be selects)
  if (column.enumValues || dataType.includes('enum')) {
    return 'select';
  }

  // UUID fields
  if (dataType === 'uuid' || columnType === 'uuid') {
    return column.isPrimary ? 'hidden' : 'uuid';
  }

  // Text types
  if (dataType === 'text' || columnType === 'text') {
    return 'textarea';
  }

  if (dataType === 'varchar' || dataType === 'char' || columnType === 'varchar') {
    const maxLength = column.length || 255;
    return maxLength > 100 ? 'textarea' : 'text';
  }

  // Numeric types
  if (dataType === 'numeric' || dataType === 'decimal' || columnType === 'numeric') {
    return 'decimal';
  }

  if (dataType === 'integer' || dataType === 'bigint' || dataType === 'smallint' ||
      columnType === 'integer' || columnType === 'bigint') {
    return 'number';
  }

  // Date/Time types
  if (dataType === 'date' || columnType === 'date') {
    return 'date';
  }

  if (dataType === 'timestamp' || dataType === 'timestamptz' ||
      columnType === 'timestamp' || dataType === 'datetime') {
    return 'datetime';
  }

  // Boolean
  if (dataType === 'boolean' || dataType === 'bool' || columnType === 'boolean') {
    return 'boolean';
  }

  // JSON
  if (dataType === 'jsonb' || dataType === 'json' || columnType === 'jsonb') {
    return 'json';
  }

  // Default to text
  return 'text';
}

/**
 * Extracts metadata from a Drizzle column
 * Enhanced with proper error handling for Drizzle ORM 0.44.6
 */
function extractColumnMetadata(column: PgColumn<any>): ColumnMetadata {
  // Safely access column internals with fallbacks
  const columnAny = column as any;
  const config = columnAny.config || columnAny._ || {};

  // Try multiple ways to access dataType (Drizzle API changed in different versions)
  const dataType = columnAny.dataType ||
                   columnAny.columnType ||
                   config.dataType ||
                   config.columnType ||
                   '';

  const columnType = columnAny.columnType ||
                     columnAny.dataType ||
                     config.columnType ||
                     config.dataType ||
                     '';

  // Extract enum values if present
  let enumValues: string[] | undefined;
  if (columnAny.enumValues) {
    enumValues = columnAny.enumValues;
  } else if (columnAny.enum) {
    enumValues = columnAny.enum.enumValues || columnAny.enum;
  } else if (config.enum) {
    enumValues = config.enum.enumValues || config.enum;
  }

  // Safely extract column name
  const name = columnAny.name || config.name || 'unknown';

  // Safely extract configuration flags
  const isPrimary = config.primaryKey === true || config.isPrimaryKey === true || false;
  const isUnique = config.unique === true || config.isUnique === true || false;
  const isNullable = config.notNull !== true;
  const hasDefault = config.hasDefault === true || config.default !== undefined;

  const metadata: ColumnMetadata = {
    name,
    type: columnType || dataType || 'text',
    dataType: dataType || 'text',
    isPrimary,
    isUnique,
    isNullable,
    hasDefault,
    defaultValue: config.default,
    enumValues,
    maxLength: config.length || config.maxLength,
    precision: config.precision,
    scale: config.scale,
    fieldType: mapColumnTypeToFieldType({
      dataType,
      columnType,
      enumValues,
      isPrimary,
      length: config.length || config.maxLength
    }),
    validation: {
      required: config.notNull === true && !hasDefault,
      min: config.min,
      max: config.max,
      pattern: config.pattern,
    }
  };

  return metadata;
}

/**
 * Introspects a Drizzle table and extracts its metadata
 * Uses Drizzle ORM's official getTableName() and getTableColumns() APIs for reliable introspection
 */
export function introspectTable(table: PgTable): TableMetadata {
  // Validate that this is actually a table
  if (!isTable(table)) {
    throw new Error('Invalid table object provided to introspectTable');
  }

  // Use Drizzle's official API to get table name
  const tableName = getTableName(table);

  // Get columns using Drizzle's official API
  const tableColumns = getTableColumns(table);

  const columns: ColumnMetadata[] = [];
  let primaryKey: string | undefined;

  // Extract column metadata from each column
  for (const [columnKey, column] of Object.entries(tableColumns)) {
    try {
      const columnMeta = extractColumnMetadata(column as PgColumn<any>);
      columns.push(columnMeta);

      if (columnMeta.isPrimary) {
        primaryKey = columnMeta.name;
      }
    } catch (error) {
      console.warn(`Failed to extract metadata for column ${columnKey}:`, error);
    }
  }

  // Extract relations (if defined in schema)
  const relations: RelationMetadata[] = [];
  if ((schema as any)[`${tableName}Relations`]) {
    const tableRelations = (schema as any)[`${tableName}Relations`];
    // Parse relations from the relations object
    // This would need more sophisticated parsing in production
  }

  return {
    name: tableName,
    columns,
    primaryKey,
    relations,
    indexes: [] // Index introspection not supported in current Drizzle version
  };
}

/**
 * Gets all available tables from the schema
 */
export function getAllTables(): Record<string, TableMetadata> {
  const tables: Record<string, TableMetadata> = {};

  // List of known tables in the schema
  const tableNames = [
    'ipos',
    'subscriptions',
    'gmpRecords',
    'financialData',
    'documents',
    'listingPerformance',
    'marketHolidays',
    'registrars',
    'peerCompanies',
    'brokerAffiliates',
    'affiliateClicks',
    'scraperLogs',
    'ipoReviews',
    'fieldProtectionMetadata',
    'auditLogs',
    'extractionLogs'
  ];

  for (const tableName of tableNames) {
    const table = (schema as any)[tableName];
    if (table && typeof table === 'object') {
      try {
        tables[tableName] = introspectTable(table);
      } catch (error) {
        console.warn(`Failed to introspect table ${tableName}:`, error);
      }
    }
  }

  return tables;
}

/**
 * Gets metadata for a specific table
 * Enhanced with validation to prevent "undefined" errors
 */
export function getTableMetadata(tableName: string): TableMetadata | null {
  // Validate table name
  if (!tableName || typeof tableName !== 'string') {
    console.error('[Schema Introspector] Invalid table name:', tableName);
    return null;
  }

  // Get table from schema
  const table = (schema as any)[tableName];

  // Comprehensive table validation
  if (!table) {
    console.error(`[Schema Introspector] Table "${tableName}" not found in schema`);
    console.error('[Schema Introspector] Available tables:', Object.keys(schema).filter(k =>
      !k.endsWith('Enum') && !k.endsWith('Relations') && typeof (schema as any)[k] === 'object'
    ));
    return null;
  }

  if (typeof table !== 'object') {
    console.error(`[Schema Introspector] Table "${tableName}" is not an object:`, typeof table);
    return null;
  }

  // Attempt introspection with comprehensive error handling
  try {
    const metadata = introspectTable(table);

    // Validate that introspection succeeded
    if (!metadata || !metadata.columns || metadata.columns.length === 0) {
      console.warn(`[Schema Introspector] Table "${tableName}" introspection returned no columns`);
    }

    return metadata;
  } catch (error) {
    console.error(`[Schema Introspector] Failed to introspect table "${tableName}":`, error);
    if (error instanceof Error) {
      console.error('[Schema Introspector] Error stack:', error.stack);
    }
    return null;
  }
}

/**
 * Gets all enum definitions from the schema
 */
export function getAllEnums(): Record<string, string[]> {
  const enums: Record<string, string[]> = {};

  // List of known enums in the schema
  const enumNames = [
    'segmentEnum',
    'offeringTypeEnum',
    'ipoStatusEnum',
    'documentTypeEnum',
    'exchangeEnum',
    'holidayTypeEnum',
    'financialStatementTypeEnum',
    'scraperSourceEnum',
    'dataSourceEnum',
    'scraperStatusEnum',
    'reviewRecommendationEnum',
    'ipoVerdictEnum',
    'confidenceLevelEnum',
    'extractionStatusEnum',
    'issueTypeEnum'
  ];

  for (const enumName of enumNames) {
    const enumDef = (schema as any)[enumName];
    if (enumDef && enumDef.enumValues) {
      enums[enumName] = enumDef.enumValues;
    }
  }

  return enums;
}

/**
 * Determines if a field should be editable in admin UI
 */
export function isFieldEditable(column: ColumnMetadata): boolean {
  // Don't allow editing of primary keys
  if (column.isPrimary) return false;

  // Don't allow editing of auto-generated fields
  if (column.name === 'createdAt' || column.name === 'updatedAt') return false;

  // Don't allow editing of system fields
  if (column.name.startsWith('_') || column.name.startsWith('sys_')) return false;

  return true;
}

/**
 * Groups columns by category for organized display
 */
export function groupColumnsByCategory(columns: ColumnMetadata[]): Record<string, ColumnMetadata[]> {
  const groups: Record<string, ColumnMetadata[]> = {
    'Basic Information': [],
    'Financial Data': [],
    'Dates': [],
    'Status': [],
    'Relationships': [],
    'System': [],
    'Other': []
  };

  for (const column of columns) {
    // Skip non-editable fields from grouping
    if (!isFieldEditable(column)) {
      groups['System'].push(column);
      continue;
    }

    const name = column.name.toLowerCase();

    // Categorize based on field name patterns
    if (name.includes('price') || name.includes('amount') || name.includes('size') ||
        name.includes('revenue') || name.includes('profit') || name.includes('financial')) {
      groups['Financial Data'].push(column);
    } else if (name.includes('date') || name.includes('time') || name === 'when') {
      groups['Dates'].push(column);
    } else if (name.includes('status') || name.includes('state') || name.includes('verdict')) {
      groups['Status'].push(column);
    } else if (column.isRelation || name.includes('_id') || name.includes('Id')) {
      groups['Relationships'].push(column);
    } else if (name === 'id' || name === 'createdat' || name === 'updatedat') {
      groups['System'].push(column);
    } else if (name.includes('name') || name.includes('title') || name.includes('description') ||
               name.includes('symbol') || name.includes('slug')) {
      groups['Basic Information'].push(column);
    } else {
      groups['Other'].push(column);
    }
  }

  // Remove empty groups
  for (const key of Object.keys(groups)) {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  }

  return groups;
}

/**
 * Validates a value against column constraints
 */
export function validateField(column: ColumnMetadata, value: any): { valid: boolean; error?: string } {
  // Check required
  if (column.validation?.required && (value === null || value === undefined || value === '')) {
    return { valid: false, error: `${column.name} is required` };
  }

  // Check string length
  if (column.maxLength && typeof value === 'string' && value.length > column.maxLength) {
    return { valid: false, error: `${column.name} must be less than ${column.maxLength} characters` };
  }

  // Check numeric ranges
  if (column.validation?.min !== undefined && Number(value) < column.validation.min) {
    return { valid: false, error: `${column.name} must be at least ${column.validation.min}` };
  }

  if (column.validation?.max !== undefined && Number(value) > column.validation.max) {
    return { valid: false, error: `${column.name} must be at most ${column.validation.max}` };
  }

  // Check enum values
  if (column.enumValues && value && !column.enumValues.includes(value)) {
    return { valid: false, error: `${column.name} must be one of: ${column.enumValues.join(', ')}` };
  }

  return { valid: true };
}