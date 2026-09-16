import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "coverage/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  // #687 slice 4: the IST calendar day has ONE implementation
  // (packages/shared/src/utils/ist-day.ts, re-exported for web as
  // lib/utils/ist-date.ts). `new Date().toISOString()` sliced to a day is the
  // UTC day, which is still "yesterday" for the first 5h30m of every IST day
  // — the bug class behind #682/#689/#687. This selector matches ONLY a slice
  // of a FRESH clock read; formatting an already-parsed date
  // (`parsed.toISOString().split('T')[0]`, the F-104 class) is a different
  // concern and is deliberately not flagged here.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.js", "**/*.mjs"],
    ignores: [
      // The helper itself and its tests must be able to name the pattern.
      "lib/utils/ist-date.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "tests/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // new Date().toISOString().split('T')[0]
          selector:
            "CallExpression[callee.property.name='split'][arguments.0.value='T'] > MemberExpression.callee > CallExpression.object[callee.property.name='toISOString'] > MemberExpression.callee > NewExpression.object[callee.name='Date'][arguments.length=0]",
          message:
            "Derive the day with istDayIso from @ipodhan/shared/utils/ist-day, never from the UTC clock (#687)",
        },
        {
          // new Date().toISOString().slice(0, 10) — the DAY slice only;
          // slice(0, 16) is a datetime-local minute string, a different class.
          selector:
            "CallExpression[callee.property.name='slice'][arguments.0.value=0][arguments.1.value=10] > MemberExpression.callee > CallExpression.object[callee.property.name='toISOString'] > MemberExpression.callee > NewExpression.object[callee.name='Date'][arguments.length=0]",
          message:
            "Derive the day with istDayIso from @ipodhan/shared/utils/ist-day, never from the UTC clock (#687)",
        },
      ],
    },
  },
  // Architectural Rules: Enforce 3-layer pattern (Component/Service → Repository → DB)
  {
    files: ["lib/services/**/*.ts", "lib/services/**/*.tsx", "app/**/*.tsx", "app/**/*.ts"],
    ignores: ["app/api/**/*.ts"], // API routes CAN use apiClient
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/api-client", "../api-client", "../../api-client", "@/lib/api-client"],
              message: `
❌ ARCHITECTURAL VIOLATION: Services and Server Components must NOT use HTTP API calls.

✅ CORRECT PATTERN (3-layer architecture):
   Server Component/Service → Repository → Database

❌ WRONG PATTERN:
   Server Component/Service → HTTP → API Route → Repository

📚 Fix: Import from '@/lib/repositories/*' and use repository pattern.

Example:
  import { db } from '@/lib/db/index';
  import { getRedisClient } from '@/lib/cache/redis-client';
  import { IPORepository } from '@/lib/repositories/ipo-repository';

  const redis = getRedisClient();
  const ipoRepository = new IPORepository(db, redis);
  const result = await ipoRepository.findAll({
    segment: ['MAINBOARD'],
    status: ['OPEN'],
    limit: 10,
    sortBy: 'openDate',
    sortOrder: 'desc',
    page: 1,
  });

📖 See: docs/02-architecture/backend-architecture.md
`,
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
