# Story 9.17a: Schema Migration - FPO Category and Separate BSE/NSE Prices

## Status
Ready for Development

## Story

**As a** database administrator and developer,
**I want** to add FPO category to the IPO category enum and separate BSE/NSE current price fields to the listing_performance table,
**so that** Story 9.17 (IPO Listings Pages) can display FPO listings with accurate exchange-specific current prices.

## Acceptance Criteria

1. FPO category added to ipoCategoryEnum:
   - Schema updated to include 'FPO' in enum values
   - Migration file created with ALTER TYPE statement
   - Backward compatible with existing MAINBOARD, SME, RIGHTS, NCD values
2. Listing performance table enhanced:
   - Add currentPriceBSE integer field (nullable)
   - Add currentPriceNSE integer field (nullable)
   - Keep existing currentPrice field for backward compatibility
   - Migration includes data migration strategy for existing records
3. TypeScript types updated:
   - IPOCategory enum in shared types includes FPO
   - ListingPerformance interface includes currentPriceBSE and currentPriceNSE
4. Migration runs successfully:
   - No data loss
   - All existing IPOs remain intact
   - All existing listing performance records remain intact
5. API endpoints support FPO category:
   - GET /api/ipos?category=FPO returns FPO IPOs
   - Filter validation includes FPO
6. Schema changes validated:
   - All relations remain intact
   - Indexes not affected
   - No breaking changes to existing queries

## Tasks / Subtasks

### Phase 1: Create Migration File

- [ ] Create migration file: `packages/database/migrations/XXXX_add_fpo_category_and_separate_exchange_prices.sql`
- [ ] Add FPO to ipoCategoryEnum:
  ```sql
  -- Add FPO category to enum
  ALTER TYPE ipo_category ADD VALUE IF NOT EXISTS 'FPO';
  ```
- [ ] Add separate BSE/NSE price fields to listing_performance:
  ```sql
  -- Add separate exchange price fields
  ALTER TABLE listing_performance
  ADD COLUMN IF NOT EXISTS current_price_bse INTEGER,
  ADD COLUMN IF NOT EXISTS current_price_nse INTEGER;

  -- Migrate existing data: copy currentPrice to both exchange fields
  UPDATE listing_performance
  SET
    current_price_bse = current_price,
    current_price_nse = current_price
  WHERE current_price IS NOT NULL;

  -- Add comment for clarity
  COMMENT ON COLUMN listing_performance.current_price_bse IS 'Current trading price at BSE';
  COMMENT ON COLUMN listing_performance.current_price_nse IS 'Current trading price at NSE';
  COMMENT ON COLUMN listing_performance.current_price IS 'Deprecated: Use current_price_bse or current_price_nse. Kept for backward compatibility.';
  ```

### Phase 2: Update Schema Definition

- [ ] Update `web/lib/db/schema.ts`:
  - [ ] Add 'FPO' to ipoCategoryEnum array (line 20-25):
    ```typescript
    export const ipoCategoryEnum = pgEnum('ipo_category', [
      'MAINBOARD',
      'SME',
      'RIGHTS',
      'NCD',
      'FPO',
    ]);
    ```
  - [ ] Add new fields to listingPerformance table (after line 265):
    ```typescript
    currentPriceBSE: integer('current_price_bse'),
    currentPriceNSE: integer('current_price_nse'),
    ```
  - [ ] Keep existing currentPrice field for backward compatibility

### Phase 3: Update TypeScript Types

- [ ] Update `packages/shared/src/types/ipo.ts`:
  - [ ] Add FPO to IPOCategory enum:
    ```typescript
    export enum IPOCategory {
      MAINBOARD = 'MAINBOARD',
      SME = 'SME',
      RIGHTS = 'RIGHTS',
      NCD = 'NCD',
      FPO = 'FPO',
    }
    ```

- [ ] Update `packages/shared/src/types/listing.ts` (or create if not exists):
  - [ ] Update ListingPerformance interface:
    ```typescript
    export interface ListingPerformance {
      id: string;
      ipoId: string;
      listingPrice: number;
      issuePrice: number;
      listingGainPercent: number;
      currentPrice: number | null; // @deprecated Use currentPriceBSE or currentPriceNSE
      currentPriceBSE: number | null;
      currentPriceNSE: number | null;
      currentGainPercent: number | null;
      lastUpdated: Date;
    }
    ```

### Phase 4: Run Migration

- [ ] Generate migration with Drizzle Kit:
  ```bash
  npm run db:generate
  ```
- [ ] Review generated migration file
- [ ] Run migration:
  ```bash
  npm run db:migrate
  ```
- [ ] Verify migration success in database

### Phase 5: Update API and Validation

- [ ] Update API route validation in `web/app/api/ipos/route.ts`:
  - [ ] Add 'FPO' to category validation array
  - [ ] Ensure filter logic supports FPO category

- [ ] Update any filter components:
  - [ ] Add FPO option to category filters
  - [ ] Update UI to display FPO category

### Phase 6: Testing

- [ ] Test FPO category:
  - [ ] Create test FPO IPO record
  - [ ] Query by category=FPO
  - [ ] Verify FPO appears in filters
  - [ ] Verify FPO badge displays correctly

- [ ] Test separate exchange prices:
  - [ ] Create listing performance with different BSE/NSE prices
  - [ ] Query and verify both prices returned
  - [ ] Verify backward compatibility (currentPrice still accessible)

- [ ] Test data migration:
  - [ ] Verify existing listing performance records have prices in new fields
  - [ ] Verify no data loss
  - [ ] Verify calculations use new fields

### Phase 7: Documentation

- [ ] Update data model documentation:
  - [ ] Document FPO category usage
  - [ ] Document currentPriceBSE and currentPriceNSE fields
  - [ ] Mark currentPrice as deprecated

- [ ] Update API documentation:
  - [ ] Document FPO category filter
  - [ ] Update ListingPerformance response schema

- [ ] Create migration notes:
  - [ ] Document migration steps
  - [ ] Document rollback strategy if needed

## Dev Notes

### Story Context

This is a **prerequisite story** for Story 9.17 (IPO Listings Pages). It adds the missing database schema elements required for the listings pages to function correctly:

1. **FPO Category**: Story 9.17 requires filtering IPOs by FPO (Follow-on Public Offer) category, but the current schema only has MAINBOARD, SME, RIGHTS, and NCD.

2. **Separate BSE/NSE Prices**: Story 9.17 displays two columns for current prices (Column 16: Current Price BSE, Column 17: Current Price NSE), but the current schema only has a single `currentPrice` field in the listing_performance table.

### Why This is Separate

This is a schema migration story separated from Story 9.17 because:
- Schema changes require database migrations
- Migrations should be reviewed and tested independently
- Story 9.17 is blocked until these schema changes are complete
- Schema changes may affect other parts of the application

### Migration Strategy

**Enum Addition (FPO)**:
- PostgreSQL allows adding enum values with `ALTER TYPE ... ADD VALUE`
- Safe operation - doesn't affect existing data
- New value available immediately after migration

**Column Addition (BSE/NSE Prices)**:
- Add as nullable columns (backward compatible)
- Migrate existing data: Copy `current_price` to both new fields
- Keep `current_price` field for backward compatibility
- Future: Deprecate and remove `current_price` in later version

**Rollback Strategy**:
- Enum values cannot be removed easily in PostgreSQL
- Column removal is straightforward: `ALTER TABLE ... DROP COLUMN`
- Keep both old and new fields during transition period
- Plan: Remove deprecated `current_price` field in version 2.0

### Data Migration

Existing listing performance records will have `current_price` populated. The migration will:
1. Copy `current_price` to `current_price_bse`
2. Copy `current_price` to `current_price_nse`
3. Keep `current_price` for backward compatibility

After migration, scrapers should be updated to populate separate BSE/NSE prices.

### Impact Assessment

**Tables Affected**:
- `ipos` table: Enum column affected, no data migration needed
- `listing_performance` table: New columns added, data migrated

**Code Impact**:
- TypeScript types: Add FPO enum value
- API validation: Add FPO to valid categories
- UI filters: Add FPO option
- Scrapers: Update to populate separate BSE/NSE prices (future enhancement)

**Risk Level**: LOW
- Additive changes only (no deletions)
- Backward compatible
- Existing queries continue to work
- No breaking changes

### Testing Requirements

**Unit Tests**:
- Test FPO category enum value exists
- Test API filters accept FPO category
- Test listing performance with separate exchange prices

**Integration Tests**:
- Test querying FPO IPOs
- Test filtering by FPO category
- Test listing performance includes both exchange prices

**Manual Tests**:
- Create FPO IPO in database
- Query by category=FPO
- Verify separate prices in listing performance
- Verify backward compatibility

### Dependencies

**Required Before**:
- Database access for migration
- Drizzle Kit for migration generation

**Blocks**:
- Story 9.17: IPO Listings Pages (CRITICAL dependency)

### Estimated Effort

- Migration file creation: 30 minutes
- Schema updates: 15 minutes
- Type updates: 15 minutes
- Migration execution: 15 minutes
- Testing: 1 hour
- Documentation: 30 minutes

**Total**: ~3 hours

### Success Criteria

Migration is successful when:
1. `SELECT unnest(enum_range(NULL::ipo_category))` includes 'FPO'
2. `\d listing_performance` shows current_price_bse and current_price_nse columns
3. Existing data migrated correctly
4. API accepts FPO category filter
5. TypeScript types compile without errors
6. All tests pass

## Change Log

| Date | Version | Description | Author |
|------|---------|-------------|--------|
| 2025-10-12 | 1.0 | Initial story created as prerequisite for Story 9.17. Adds FPO category to ipoCategoryEnum and separate currentPriceBSE/currentPriceNSE fields to listing_performance table. Includes data migration strategy and backward compatibility plan. Estimated effort: 3 hours. Risk level: LOW (additive changes only). | Bob (Scrum Master) |

## Dev Agent Record

### Agent Model Used
_To be filled by Dev agent during implementation_

### Debug Log References
_To be filled by Dev agent during implementation_

### Completion Notes List
_To be filled by Dev agent during implementation_

### File List
_To be filled by Dev agent during implementation_

## QA Results
_To be filled by QA agent after validation_
