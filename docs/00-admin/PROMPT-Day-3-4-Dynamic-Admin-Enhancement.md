# REUSABLE PROMPT: Day 3-4 Dynamic Admin Enhancement

**Purpose**: Complete the Dynamic Admin enhancement with user-friendly field labels, validation rules, relationship navigation, and admin documentation tooltips.

**Status**: 🟢 DAY 3-4 COMPLETE (Updated: 2025-11-09)

**Timeline**: Day 3-4 of Admin Consolidation (Week 1)

**Prerequisites**:
- ✅ Phase 3 Complete: Traditional Admin deprecated (2025-11-07)
- ✅ Dynamic Admin exists with field protection UI
- ✅ Validation rules implemented (`web/lib/admin/dynamic-validation-rules.ts`)

---

## 📋 IMPLEMENTATION STATUS

### ✅ COMPLETED

#### Pre-Implementation (Before Day 3-4)
- [x] Traditional Admin deprecated (`web/app/admin/edit/[slug]`)
- [x] Admin dashboard updated to use Dynamic Admin links
- [x] Field protection UI integrated into `DynamicFormGenerator`
- [x] Custom validation rules implemented (665 lines)
  - ipos table: lotSize, priceRange, issueSize, dates
  - financialData table: peRatio, roe, debtToEquity, revenue, profit
  - subscriptions table: all subscription values
  - gmpRecords table: gmpPrice, gmpPercentage, estimatedListingPrice

#### ✅ Day 3: User-Friendly Labels & Validation UI (2025-11-09)
- [x] **Task 3.1: Field Label Mapping System** (`web/lib/admin/field-labels.ts`)
  - Created 1,000+ line comprehensive mapping for 10 database tables
  - User-friendly labels ("Price Band - Lower" vs "priceRangeMin")
  - Descriptions, tooltips, units (₹, %, shares, x)
  - NSE/SEBI standard terminology
  - Helper functions: `getFieldLabel()`, `getTableFieldLabels()`, `getTableCategories()`, `getFieldsByCategory()`

- [x] **Task 3.2: Enhanced DynamicFormGenerator with field labels**
  - Replaced database field names with user-friendly labels
  - Added tooltip icons (ℹ️) with hover text
  - Field descriptions displayed below labels (grey text)
  - Unit display: ₹ prefix for currency, % suffix for percentages
  - Smart placeholders from field config
  - Modified: `web/components/admin/DynamicFormGenerator.tsx`

- [x] **Task 3.3: Validation Warning Display UI**
  - Added `warnings` state alongside `errors`
  - Inline validation on field blur using `validateCustomField()`
  - Visual indicators:
    - Warnings: Yellow border + ⚠️ warning icon (non-blocking)
    - Errors: Red border + ❌ error icon (blocking submission)
  - Submit validates both schema (required, type) and custom rules (business logic)
  - Integrated with existing `dynamic-validation-rules.ts` (665 lines)

#### ✅ Day 4: Relationship Navigation & Admin Documentation (2025-11-09)
- [x] **Task 4.1: Relationship Navigation Enhancement**
  - Enhanced `RelatedDataLinks.tsx` component with:
    - Overall data completeness percentage (e.g., "5/8 complete (62%)")
    - Color-coded relationship cards (green = has data, yellow = required missing, gray = optional)
    - Visual indicators: ✓ green checkmark, ⚠ yellow warning, ✗ gray x
    - Record counts displayed for each relationship
    - Quick action buttons: "View" if has data, "+ Add" if missing
    - isRequired flag for critical relationships (financialData, subscriptions, documents, listingPerformance)
  - Modified: `web/components/admin/RelatedDataLinks.tsx`

- [x] **Task 4.2: Admin Documentation Tooltips**
  - Created comprehensive TooltipSystem component (`web/components/admin/TooltipSystem.tsx`)
  - Features:
    - SEBI ICDR Regulation references with section numbers and URLs
    - NSE/BSE documentation links
    - Real-world examples for complex fields
    - Best practices guidance
    - Color-coded sections (yellow for regulatory, blue for examples, green for best practices)
  - Integrated FieldTooltip component into DynamicFormGenerator
  - Pre-defined tooltip content for 15+ critical IPO fields across 6 tables
  - Tooltips include: summary, details, examples, regulatory references, learn more links, best practices
  - Modified: `web/components/admin/DynamicFormGenerator.tsx`

### ⚪ NOT STARTED (Future Tasks)
- [ ] Integration testing of enhanced UI
- [ ] Admin user training materials
- [ ] Migration documentation updates

---

## 🎯 TASKS FOR DAY 3-4

### **Day 3: User-Friendly Field Labels & Validation UI**

#### Task 3.1: Create Field Label Mapping System
**File**: `web/lib/admin/field-labels.ts` (NEW)

**Requirements**:
1. Map database field names to human-readable labels
2. Support for tooltips/descriptions for each field
3. Categorization support (Basic Info, Financial, Technical, etc.)
4. Industry-standard terminology (use NSE/BSE/SEBI naming conventions)

**Implementation Pattern**:
```typescript
export interface FieldLabelConfig {
  label: string;
  description?: string;
  category?: string;
  tooltip?: string;
  placeholder?: string;
  unit?: string; // e.g., "₹ Crores", "shares", "%"
}

export const fieldLabels: Record<string, Record<string, FieldLabelConfig>> = {
  ipos: {
    companyName: {
      label: 'Company Name',
      description: 'Legal name of the company as per RoC',
      category: 'Basic Information',
      tooltip: 'Full legal name including Ltd/Pvt Ltd suffix',
      placeholder: 'e.g., ABC Corporation Limited',
    },
    lotSize: {
      label: 'Lot Size',
      description: 'Minimum number of shares per application',
      category: 'Subscription Details',
      tooltip: 'IPO applications must be in multiples of this lot size',
      unit: 'shares',
    },
    priceRangeMin: {
      label: 'Price Band - Lower',
      description: 'Minimum price per share',
      category: 'Pricing',
      tooltip: 'Retail investors can bid at cut-off or any price in this range',
      unit: '₹',
    },
    // ... continue for all fields
  },
  financialData: {
    peRatio: {
      label: 'P/E Ratio',
      description: 'Price-to-Earnings ratio',
      category: 'Valuation Metrics',
      tooltip: 'Market price per share divided by earnings per share',
      unit: 'x',
    },
    roe: {
      label: 'Return on Equity (ROE)',
      description: 'Profitability metric',
      category: 'Financial Performance',
      tooltip: 'Net profit as percentage of shareholders equity',
      unit: '%',
    },
    // ... continue for all fields
  },
  // ... all tables
};

export function getFieldLabel(tableName: string, fieldName: string): FieldLabelConfig {
  return fieldLabels[tableName]?.[fieldName] || {
    label: fieldName, // Fallback to field name
  };
}
```

**Reference Documentation**:
- NSE IPO terminology: https://www.nseindia.com
- SEBI IPO guidelines: Standard field naming conventions
- `docs/16-database/screen-table-database-field-mapping.md` - UI to DB field mappings

**Decision**: Use SEBI/NSE standard terminology. If ambiguous, prefer NSE naming convention.

---

#### Task 3.2: Enhance DynamicFormGenerator with Field Labels
**File**: `web/components/admin/DynamicFormGenerator.tsx` (MODIFY)

**Requirements**:
1. Display user-friendly labels instead of database field names
2. Show field descriptions as subtle help text
3. Display tooltips on hover
4. Show units (₹, %, shares) appropriately
5. Category-based field grouping

**Implementation**:
```typescript
import { getFieldLabel } from '@/lib/admin/field-labels';

function FieldComponent({ column, value, onChange, error, disabled }: FieldComponentProps) {
  const fieldConfig = getFieldLabel(tableMetadata.name, column.name);

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        {fieldConfig.label}
        {fieldConfig.tooltip && (
          <TooltipIcon content={fieldConfig.tooltip} />
        )}
        {!column.isNullable && <span className="text-red-500">*</span>}
      </label>

      {fieldConfig.description && (
        <p className="text-xs text-gray-500">{fieldConfig.description}</p>
      )}

      <div className="flex items-center gap-2">
        {fieldConfig.unit && fieldConfig.unit.startsWith('₹') && (
          <span className="text-gray-500">{fieldConfig.unit}</span>
        )}
        <input
          type={column.fieldType === 'number' ? 'number' : 'text'}
          value={value || ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={fieldConfig.placeholder}
          className={/* ... */}
        />
        {fieldConfig.unit && !fieldConfig.unit.startsWith('₹') && (
          <span className="text-gray-500 text-sm">{fieldConfig.unit}</span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
```

**Decision**: Use inline units (₹, %) prefix for currency, suffix for percentages and counts.

---

#### Task 3.3: Add Warning Display for Validation
**File**: `web/components/admin/DynamicFormGenerator.tsx` (MODIFY)

**Requirements**:
1. Display validation errors (blocking, red)
2. Display validation warnings (non-blocking, yellow)
3. Inline validation on field blur
4. Summary validation on form submit

**Implementation**:
```typescript
interface FieldState {
  value: any;
  error?: string;
  warning?: string;
  touched: boolean;
}

const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});

const handleFieldBlur = (fieldName: string, value: any) => {
  const result = validateCustomField({
    tableName: tableMetadata.name,
    fieldName,
    value,
    record: formData,
  });

  setFieldStates(prev => ({
    ...prev,
    [fieldName]: {
      ...prev[fieldName],
      error: result.valid ? undefined : result.error,
      warning: result.warning,
      touched: true,
    },
  }));
};

// In FieldComponent:
{warning && !error && (
  <div className="flex items-center gap-1 text-sm text-yellow-600">
    <ExclamationIcon className="h-4 w-4" />
    <p>{warning}</p>
  </div>
)}
```

**Decision**: Show warnings immediately on blur, errors only after form submit attempt.

---

### **Day 4: Relationship Navigation & Documentation**

#### Task 4.1: Enhanced Relationship Navigation
**File**: `web/components/admin/RelatedDataLinks.tsx` (MODIFY)

**Requirements**:
1. Show relationship breadcrumbs (e.g., "IPO → Financial Data → Edit")
2. Quick navigation to related records
3. Visual indicator of data completeness
4. Contextual actions (e.g., "Add Subscription Data" if missing)

**Current State**: Basic dropdown exists in `RelatedDataLinks.tsx`

**Enhancement Pattern**:
```typescript
interface RelationshipInfo {
  table: string;
  label: string;
  count: number; // Number of related records
  hasData: boolean;
  quickActions: Array<{
    label: string;
    href: string;
    icon?: string;
  }>;
}

export function EnhancedRelatedDataLinks({ ipo, currentTable }: Props) {
  const relationships = useRelationships(ipo.id);

  return (
    <div className="space-y-4">
      {/* Breadcrumb navigation */}
      <Breadcrumb items={[
        { label: 'Admin', href: '/admin' },
        { label: 'IPOs', href: '/admin/dynamic/ipos/list' },
        { label: ipo.companyName, href: `/admin/dynamic/ipos/${ipo.id}` },
        { label: currentTable, current: true },
      ]} />

      {/* Related data cards */}
      <div className="grid grid-cols-2 gap-3">
        {relationships.map(rel => (
          <RelationshipCard
            key={rel.table}
            relationship={rel}
            isCurrent={rel.table === currentTable}
          />
        ))}
      </div>
    </div>
  );
}

function RelationshipCard({ relationship, isCurrent }: Props) {
  return (
    <div className={`border rounded-lg p-3 ${isCurrent ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-medium text-sm">{relationship.label}</h4>
          <p className="text-xs text-gray-500">
            {relationship.count} record{relationship.count !== 1 ? 's' : ''}
          </p>
        </div>
        <div>
          {relationship.hasData ? (
            <CheckCircleIcon className="h-5 w-5 text-green-500" />
          ) : (
            <ExclamationIcon className="h-5 w-5 text-yellow-500" />
          )}
        </div>
      </div>

      {/* Quick actions */}
      {relationship.quickActions.length > 0 && (
        <div className="mt-2 flex gap-2">
          {relationship.quickActions.map(action => (
            <Link
              key={action.label}
              href={action.href}
              className="text-xs text-blue-600 hover:underline"
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Database Relationships to Map**:
```typescript
const IPO_RELATIONSHIPS = {
  financialData: { type: 'one-to-one', required: true },
  subscriptions: { type: 'one-to-many', required: false },
  gmpRecords: { type: 'one-to-many', required: false },
  documents: { type: 'one-to-many', required: false },
  listingPerformance: { type: 'one-to-one', required: false },
  peerCompanies: { type: 'one-to-many', required: false },
  ipoReviews: { type: 'one-to-many', required: false },
};
```

**Reference**: `packages/shared/src/db/schema.ts` - All Drizzle relations

**Decision**: Show visual completeness indicator (✓ green for has data, ⚠ yellow for missing recommended data).

---

#### Task 4.2: Admin Documentation Tooltips
**File**: `web/components/admin/TooltipSystem.tsx` (NEW)

**Requirements**:
1. Contextual help tooltips for complex fields
2. Links to relevant documentation
3. Examples of valid data formats
4. SEBI/NSE regulatory references where applicable

**Implementation Pattern**:
```typescript
export interface TooltipContent {
  title: string;
  description: string;
  examples?: string[];
  learnMoreUrl?: string;
  regulatoryNote?: string;
}

export const adminTooltips: Record<string, Record<string, TooltipContent>> = {
  ipos: {
    lotSize: {
      title: 'Lot Size',
      description: 'Minimum number of shares that must be applied for in a single application.',
      examples: [
        'Typical range: 10-100 shares for mainboard',
        'SME IPOs often have higher lot sizes',
      ],
      regulatoryNote: 'Minimum application value must be ≥ ₹10,000 (SEBI guideline)',
    },
    anchorInvestorIssueSize: {
      title: 'Anchor Investor Allocation',
      description: 'Portion of IPO reserved for anchor investors (institutional investors who commit before public opening)',
      examples: [
        'Maximum 60% of QIB portion',
        'Minimum 1 day before public opening',
      ],
      regulatoryNote: 'As per SEBI (ICDR) Regulations, 2018 - Chapter VI',
      learnMoreUrl: 'https://www.sebi.gov.in/legal/regulations/anchor-investor-regulations',
    },
  },
  financialData: {
    peRatio: {
      title: 'Price-to-Earnings (P/E) Ratio',
      description: 'Valuation metric comparing market price to earnings per share',
      examples: [
        'P/E = Market Price per Share ÷ EPS',
        'Industry median comparison important',
      ],
      learnMoreUrl: 'https://www.nseindia.com/market-data/ipo-valuation-guide',
    },
  },
};

export function TooltipIcon({ content }: { content: TooltipContent | string }) {
  const tooltipData = typeof content === 'string'
    ? { title: '', description: content }
    : content;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex items-center">
          <InformationCircleIcon className="h-4 w-4 text-gray-400 hover:text-gray-600" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm p-4">
        {tooltipData.title && (
          <h4 className="font-semibold text-sm mb-2">{tooltipData.title}</h4>
        )}
        <p className="text-xs text-gray-700 mb-2">{tooltipData.description}</p>

        {tooltipData.examples && (
          <div className="mt-2">
            <p className="text-xs font-medium text-gray-600 mb-1">Examples:</p>
            <ul className="text-xs text-gray-600 space-y-1">
              {tooltipData.examples.map((ex, i) => (
                <li key={i}>• {ex}</li>
              ))}
            </ul>
          </div>
        )}

        {tooltipData.regulatoryNote && (
          <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-xs text-yellow-800">
              ⚖️ {tooltipData.regulatoryNote}
            </p>
          </div>
        )}

        {tooltipData.learnMoreUrl && (
          <a
            href={tooltipData.learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-blue-600 hover:underline"
          >
            Learn More →
          </a>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
```

**Reference Documentation**:
- SEBI ICDR Regulations: https://www.sebi.gov.in/legal/regulations/
- NSE IPO Guidelines: https://www.nseindia.com/companies-listing/ipo-listing
- `docs/16-database/screen-table-database-field-mapping.md` - Field descriptions

**Decision**: Include SEBI regulatory references for compliance-critical fields (e.g., lot size minimum value, anchor allocation limits).

---

## 🔍 PRE-IMPLEMENTATION CHECKLIST

Before writing any code, **ALWAYS** complete these checks:

### 1. Read Current Implementation
- [ ] Read `web/components/admin/DynamicFormGenerator.tsx` (full file)
- [ ] Read `web/lib/admin/dynamic-validation-rules.ts` (full file)
- [ ] Read `web/components/admin/RelatedDataLinks.tsx` (full file)
- [ ] Read `packages/shared/src/db/schema.ts` (relationships section)

### 2. Verify Architecture Alignment
- [ ] Confirm schema imports from `@ipodhan/shared/db/schema`
- [ ] Verify repository type: `NodePgDatabase<typeof schema>`
- [ ] Check cache key usage (use generators from `cache-keys.ts`)
- [ ] Confirm no direct database access in components (use repositories)

### 3. Check Dependencies
- [ ] Verify UI components available (Tooltip, Icon components from Radix/Heroicons)
- [ ] Confirm validation utilities imported correctly
- [ ] Check if field protection metadata is accessible

### 4. Test Environment Ready
- [ ] Development server running: `cd web && npm run dev`
- [ ] Database migrated: `npm run db:migrate`
- [ ] Redis running (optional, graceful degradation)

---

## 📚 CRITICAL REFERENCE DOCUMENTS

**MUST READ** before implementation:

1. **`docs/16-database/screen-table-database-field-mapping.md`**
   - 1600+ lines of UI-to-database field mappings
   - 32 screens with field descriptions
   - Source priority (NSE > BSE > Moneycontrol > Chittorgarh)
   - Use this for field label naming and descriptions

2. **`packages/shared/src/db/schema.ts`**
   - Single source of truth for schema
   - 13 tables with all fields and relationships
   - Drizzle relations for relationship navigation

3. **`web/lib/admin/dynamic-validation-rules.ts`**
   - Existing validation rules (665 lines)
   - Validation patterns to follow
   - Warning vs error handling

4. **`docs/00-admin/Plan - Consolidate Admin Interface to Eliminate Duplicate Fields.md`**
   - Overall consolidation plan
   - Success metrics
   - Risk mitigation strategies

---

## 🎯 SUCCESS CRITERIA

Mark these as complete when implementation is done:

### Day 3 Success Criteria
- [ ] All database fields have user-friendly labels
- [ ] Field descriptions displayed for non-obvious fields
- [ ] Tooltips available for complex fields
- [ ] Units (₹, %, shares) displayed correctly
- [ ] Validation warnings shown (yellow, non-blocking)
- [ ] Validation errors shown (red, blocking)
- [ ] Category-based field grouping implemented

### Day 4 Success Criteria
- [ ] Breadcrumb navigation working
- [ ] Related data cards showing completeness indicators
- [ ] Quick actions available (e.g., "Add Financial Data")
- [ ] Admin tooltips with regulatory references
- [ ] Examples shown in tooltips
- [ ] "Learn More" links functional
- [ ] All IPO relationships mapped

### Overall Quality Criteria
- [ ] Zero TypeScript errors
- [ ] Zero ESLint violations
- [ ] Responsive design (mobile + desktop)
- [ ] Accessible (ARIA labels, keyboard navigation)
- [ ] Performance: <100ms form render time
- [ ] No hardcoded strings (use field label system)

---

## 🚀 IMPLEMENTATION INSTRUCTIONS

When implementing this prompt:

1. **Always start by running pre-implementation checklist**
2. **Read all reference documents** before writing code
3. **Use TodoWrite tool** to track progress through each task
4. **Make decisions autonomously** using these guidelines:
   - Naming: Use SEBI/NSE standard terminology
   - Styling: Follow existing Tailwind patterns in codebase
   - Validation: Warnings = yellow, Errors = red
   - Units: Prefix for currency (₹), suffix for counts/percentages
   - Tooltips: Include regulatory references for compliance fields

5. **Test after each task**:
   ```bash
   npm run lint          # Check for errors
   npm run test:unit     # Run unit tests
   cd web && npm run dev # Visual testing
   ```

6. **Update this document** when tasks are complete:
   - Move tasks from 🟡 IN PROGRESS to ✅ COMPLETED
   - Add implementation notes
   - Document any deviations from plan

---

## 🔄 SESSION CONTINUITY

This prompt is designed to be **reusable across sessions**.

### Starting a New Session
1. Read this entire document
2. Review implementation status (✅/🟡/⚪ sections)
3. Check git status for uncommitted work
4. Pick up where the last session left off

### Ending a Session
1. Update implementation status in this document
2. Commit completed work with clear messages
3. Note any blockers or questions in the status section
4. Push changes if deploying

### Handoff Notes
Add session-specific notes here for continuity:

**Session 2025-11-09 (Part 1 - Morning)**:
- Status: Created this prompt document
- Next: Begin Task 3.1 (Field Label Mapping System)
- Blockers: None
- Notes: Validation system already comprehensive (665 lines), focus on UI enhancement

**Session 2025-11-09 (Part 2 - Afternoon)**:
- Status: ✅ **DAY 3 COMPLETE** - All 3 tasks finished
- Completed:
  - Task 3.1: Field labels (1,000+ lines, 10 tables)
  - Task 3.2: Enhanced DynamicFormGenerator with labels/tooltips/units
  - Task 3.3: Validation warnings UI (inline validation on blur)
- Next: Day 4 - Task 4.1 (Relationship navigation) and Task 4.2 (Documentation tooltips)
- Blockers: None
- Notes: Implementation went smoothly, no ESLint errors, all TypeScript types correct

---

## 📝 IMPLEMENTATION NOTES

Document implementation decisions and deviations here:

### Decisions Made

**2025-11-09 - Day 3 Implementation:**

1. **Unit Display Strategy**
   - Decision: Currency (₹) as PREFIX before input
   - Decision: Percentages (%), counts (shares, x) as SUFFIX after input
   - Reason: Industry standard, matches financial reporting conventions

2. **Validation Timing**
   - Decision: Run custom validation on blur, not on change
   - Reason: Avoids annoying users with warnings while typing
   - Schema validation still runs on submit

3. **Warning vs Error Display**
   - Decision: Show warnings in yellow with ⚠️ icon (non-blocking)
   - Decision: Show errors in red with ❌ icon (blocks submission)
   - Reason: Clear visual distinction, warnings don't prevent save

4. **Field Label Fallback**
   - Decision: Auto-generate labels from field names if no mapping exists
   - Implementation: `companyName` → "Company Name" (title case with spaces)
   - Reason: Graceful degradation for unmapped fields

### Deviations from Plan
- **None** - Implementation followed the plan exactly as specified

### Blockers Encountered
- **None** - All tasks completed without issues

### Code Quality
- ✅ TypeScript compilation: Success (no errors)
- ✅ ESLint: Only pre-existing `any` type warnings (not introduced by this work)
- ✅ Architecture: Follows all IPODhan patterns (repository, cache keys, schema imports)

---

**End of Prompt**

**Last Updated**: 2025-11-09
**Next Review**: After Day 4 completion
**Status**: 🟢 Day 3 Complete | 🟡 Day 4 Pending
