# TypeScript Monorepo Expert

**Purpose:** This skill provides expertise in TypeScript workspace management, project references, dependency configuration, and build optimization for IPODhan's monorepo structure.

**When to invoke:** Use this skill when configuring workspaces, resolving import errors, setting up project references, managing shared dependencies, or troubleshooting build issues.

---

## Monorepo Structure

```
IPODhan/
├── package.json            # Root workspace config
├── tsconfig.json           # Root TS config with references
├── packages/
│   └── shared/
│       ├── package.json    # Shared utilities
│       ├── tsconfig.json   # Shared TS config
│       └── src/
│           ├── db/schema.ts    # Database schema
│           └── utils/slug.ts   # Shared utilities
├── web/
│   ├── package.json        # Next.js app
│   ├── tsconfig.json       # Web TS config
│   ├── app/                # Next.js App Router
│   └── lib/                # Web-specific code
└── scraper/
    ├── package.json        # Scraper service
    ├── tsconfig.json       # Scraper TS config
    └── src/                # Scraper code
```

---

## Workspace Configuration

### Root package.json

```json
{
  "name": "ipodhan",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "web",
    "scraper",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev --workspace=web",
    "dev:scraper": "npm run dev --workspace=scraper"
  },
  "overrides": {
    "zod": "^4.1.11"
  }
}
```

**Key Points:**
- `workspaces` defines packages
- `overrides` forces Zod version across all workspaces (prevents conflicts)
- Scripts can target specific workspaces

---

## TypeScript Project References

### Root tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "references": [
    { "path": "./packages/shared" },
    { "path": "./web" },
    { "path": "./scraper" }
  ],
  "files": []
}
```

### Shared Package tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "commonjs",
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "strict": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Key Options:**
- `composite: true` - Enables project references
- `declaration: true` - Generates .d.ts files
- `declarationMap: true` - Enables jump-to-definition

### Web tsconfig.json

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "paths": {
      "@/*": ["./*"],
      "@ipodhan/shared/*": ["../packages/shared/src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules"],
  "references": [
    { "path": "../packages/shared" }
  ]
}
```

**Key Options:**
- `paths` - Import path aliases
- `references` - Depends on shared package
- `moduleResolution: "bundler"` - Next.js 15 requirement

---

## Import Path Patterns

### From Web to Shared

```typescript
// ✅ CORRECT - Using path alias
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import * as schema from '@ipodhan/shared/db/schema';

// ✅ CORRECT - Using relative path
import { generateIPOSlug } from '../../../packages/shared/src/utils/slug';

// ❌ WRONG - Package name without path mapping
import { generateIPOSlug } from '@ipodhan/shared'; // Won't work
```

### Within Web Package

```typescript
// ✅ CORRECT - Using @ alias
import { db } from '@/lib/db';
import { IPORepository } from '@/lib/repositories/ipo-repository';

// ✅ CORRECT - Relative path
import { db } from '../lib/db';

// ❌ WRONG - No alias configured
import { db } from '~/lib/db';
```

### From Scraper to Shared

```typescript
// ✅ CORRECT
import * as schema from '@ipodhan/shared/db/schema';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
```

---

## Dependency Management

### Installing Dependencies

```bash
# Install in specific workspace
npm install drizzle-orm --workspace=web

# Install in all workspaces
npm install -ws zod

# Install shared package in web
cd web
npm install @ipodhan/shared@*
```

### Shared Dependencies

Declare shared package in web/package.json:

```json
{
  "dependencies": {
    "@ipodhan/shared": "*",
    "next": "^15.5.4",
    "drizzle-orm": "^0.44.6"
  }
}
```

---

## Zod Version Conflict Resolution

**Problem:** Multiple Zod versions in dependency tree

**Solution:** Use `overrides` in root package.json

```json
{
  "overrides": {
    "zod": "^4.1.11"
  }
}
```

**Verify:**
```bash
npm ls zod
```

**Should show single version:**
```
ipodhan@1.0.0
├─┬ web@0.1.0
│ └── zod@4.1.11
└─┬ scraper@1.0.0
  └── zod@4.1.11
```

---

## Build Order

TypeScript builds packages in dependency order:

```bash
# Build all packages (respects references)
npm run build -ws

# Build specific workspace
npm run build --workspace=web
```

**Build Order:**
1. packages/shared (no dependencies)
2. web (depends on shared)
3. scraper (depends on shared)

---

## Common Issues

### Issue: Cannot find module '@ipodhan/shared'

**Solution:**
```bash
# Build shared package first
npm run build --workspace=packages/shared

# Or install dependencies
npm install
```

### Issue: TypeScript can't find types from shared

**Solution:**
1. Ensure `composite: true` in shared tsconfig.json
2. Ensure `declaration: true` in shared tsconfig.json
3. Build shared package: `npm run build --workspace=packages/shared`

### Issue: Changes in shared not reflected

**Solution:**
```bash
# Rebuild shared package
cd packages/shared
npm run build

# Or use watch mode during development
npm run build -- --watch
```

---

## Best Practices

1. **Always build shared first** after schema changes
2. **Use path aliases** for cleaner imports
3. **Pin critical versions** in overrides (like Zod)
4. **Use project references** for better IDE support
5. **Keep workspaces independent** - shared should have no dependencies on web/scraper

---

## References

- **TypeScript Project References:** https://www.typescriptlang.org/docs/handbook/project-references.html
- **npm Workspaces:** https://docs.npmjs.com/cli/v8/using-npm/workspaces

---

**Note:** Proper monorepo configuration is critical for maintainability. IPODhan's structure with shared schema and utilities prevents code duplication and ensures consistency.
