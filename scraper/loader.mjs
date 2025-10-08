/**
 * Custom ESM loader for resolving TypeScript path aliases
 * Handles @web, @shared, @scraper aliases at runtime
 */

import { resolve as resolvePath, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read tsconfig to get path mappings
const tsconfigPath = resolvePath(__dirname, 'tsconfig.json');
const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
const paths = tsconfig.compilerOptions?.paths || {};
const baseUrl = tsconfig.compilerOptions?.baseUrl || '.';

export async function resolve(specifier, context, nextResolve) {
  // Check if specifier matches any path alias
  for (const [alias, targets] of Object.entries(paths)) {
    const aliasPattern = alias.replace('/*', '');

    if (specifier.startsWith(aliasPattern)) {
      // Replace alias with actual path
      const target = targets[0].replace('/*', '');
      const relativePath = specifier.substring(aliasPattern.length);
      const absolutePath = resolvePath(__dirname, baseUrl, target, relativePath);

      // Try with .ts extension
      try {
        return nextResolve(pathToFileURL(absolutePath + '.ts').href, context);
      } catch {
        // Try with .js extension
        try {
          return nextResolve(pathToFileURL(absolutePath + '.js').href, context);
        } catch {
          // Try without extension
          try {
            return nextResolve(pathToFileURL(absolutePath).href, context);
          } catch {
            // Fall through to default resolution
          }
        }
      }
    }
  }

  // Default resolution
  return nextResolve(specifier, context);
}
