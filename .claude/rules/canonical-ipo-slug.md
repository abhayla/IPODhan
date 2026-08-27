---
name: canonical-ipo-slug
description: >
  Enforces using generateIPOSlug() from @ipodhan/shared as the single source of
  truth for IPO URL slugs, with its canonical legal-entity normalization, so the
  same company always resolves to one unique, stable slug across web and scraper.
paths: ["packages/shared/src/utils/slug.ts", "web/**/*.ts", "web/**/*.tsx", "scraper/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Canonical IPO Slug Generation

An IPO's slug is its public URL key and is **unique-indexed** in the `ipos` table.
Because web routes, the scraper, and dedup all derive it from the company name,
the slug MUST come from one canonical function so the same company never produces
two different slugs.

## Always use `generateIPOSlug`

```typescript
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

generateIPOSlug('A & B Company')          // 'a-and-b-company'
generateIPOSlug('Acme Limited')           // 'acme-ltd'      (canonical)
generateIPOSlug('Acme Private Limited')   // 'acme-private-ltd'
generateIPOSlug('Foo IPO')                // 'foo'           (IPO/FPO suffix stripped)
```

- MUST import from `@ipodhan/shared/utils/slug` — MUST NOT hand-roll
  `name.toLowerCase().replace(/\s+/g,'-')`; that skips the canonicalization and
  creates collisions/duplicates against existing rows
- MUST NOT "fix" a slug by editing it inline; if a normalization rule is wrong,
  change `slug.ts` so every caller benefits

## Why the normalization rules exist

`slug.ts` deliberately normalizes legal-entity suffixes to a canonical form
(`Limited` → `-ltd`, `Pvt. Ltd.` → `-pvt-ltd`, `&` → `and`) and strips trailing
`IPO`/`FPO`. This is what lets duplicate detection (see `ipo-duplicate-detection.md`)
and the unique index treat "Acme Limited" and "Acme Ltd" as the same entity.

- A schema change that loosens the slug unique constraint, or a new write that
  sets `slug` without `generateIPOSlug`, breaks that guarantee — don't
