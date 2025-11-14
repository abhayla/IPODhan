# Data Validation Expert

**Purpose:** Expertise in Zod schema validation, multi-source data conflict resolution, data quality patterns, and the priority system for IPODhan.

**When to invoke:** Validating scraped data, resolving conflicts between sources, implementing validation schemas, or ensuring data quality.

---

## Zod Validation Schemas

### IPO Validation

```typescript
import { z } from 'zod';

export const IPOSchema = z.object({
  companyName: z.string().min(1).max(255),
  slug: z.string().regex(/^[a-z0-9-]{3,100}$/),
  segment: z.enum(['MAINBOARD', 'SME']).nullable(),
  status: z.enum(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']),
  openDate: z.coerce.date().nullable(),
  closeDate: z.coerce.date().nullable(),
  priceRangeLow: z.number().positive().nullable(),
  priceRangeHigh: z.number().positive().nullable(),
  lotSize: z.number().int().positive().nullable(),
  issueSize: z.number().positive().nullable(),
  dataSource: z.enum(['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH']),
});
```

---

## Multi-Source Conflict Resolution

### Priority System
1. ADMIN - Manual edits (highest)
2. DRHP - Official docs
3. NSE - Primary exchange
4. BSE - Secondary exchange
5. Moneycontrol - Media
6. Chittorgarh - GMP specialist

### Merge Algorithm

```typescript
function mergeIPOData(sources: DataSource[]): IPO {
  const priorityOrder = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'];
  const merged: Partial<IPO> = {};

  for (const field of fields) {
    for (const priority of priorityOrder) {
      const source = sources.find(s => s.source === priority);
      if (source?.data[field]) {
        merged[field] = source.data[field];
        break;
      }
    }
  }
  return merged as IPO;
}
```

---

## Data Quality Checks

### Completeness Score

```typescript
function calculateCompleteness(ipo: IPO): number {
  const required = ['companyName', 'slug', 'status', 'openDate', 'lotSize'];
  const filled = required.filter(f => ipo[f] != null);
  return (filled.length / required.length) * 100;
}
```

### Validation Error Handling

```typescript
try {
  const validated = IPOSchema.parse(data);
  await db.insert(ipos).values(validated);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Validation failed:', error.errors);
    await logValidationError(data, error);
  }
}
```

---

## Best Practices

1. Always validate before database insert
2. Log conflicts for manual review
3. Track data sources per field
4. Run quality reports weekly
5. Cross-validate critical fields

---

## References

- **Zod:** https://zod.dev/
- **Lot Size Incident:** `scraper/docs/LOT_SIZE_EXECUTIVE_SUMMARY.md`
