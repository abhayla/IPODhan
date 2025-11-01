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
