/**
 * Wrapper script to ensure environment variables are loaded before TypeScript execution
 * This loads .env.local BEFORE tsx loads any TypeScript modules
 */

/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

// Verify environment variables are loaded
if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
  console.error('❌ ERROR: No database configuration found!');
  console.error('Make sure .env.local exists with DATABASE_URL or DATABASE_* variables');
  process.exit(1);
}

console.log('✓ Environment variables pre-loaded');

// Now execute the TypeScript seed script
require('child_process').execSync('tsx scripts/seed-data.ts', {
  stdio: 'inherit',
  cwd: __dirname + '/..',
  env: process.env
});
