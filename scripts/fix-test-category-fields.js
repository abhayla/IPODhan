#!/usr/bin/env node
/**
 * Fix Test Category Fields - Story 11.8b
 * Systematic find-replace operations to update all test files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const testDir = path.join(__dirname, '..', 'web', 'tests');

// Find all test files
const findCommand = process.platform === 'win32'
  ? `cd "${testDir}" && dir /s /b *.ts *.tsx`
  : `find "${testDir}" -type f \\( -name "*.ts" -o -name "*.tsx" \\)`;

let files;
try {
  const output = execSync(findCommand, { encoding: 'utf8' });
  files = output.trim().split('\n').filter(f => f.trim());
} catch (error) {
  console.error('Error finding files:', error.message);
  process.exit(1);
}

console.log(`\n🔍 Found ${files.length} test files to process...\n`);

const replacements = [
  {
    name: 'MAINBOARD → segment: MAINBOARD + offeringType: IPO',
    pattern: /category:\s*(['"])MAINBOARD\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'MAINBOARD' as const,\n  offeringType: 'IPO' as const"
  },
  {
    name: 'SME → segment: SME + offeringType: IPO',
    pattern: /category:\s*(['"])SME\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'SME' as const,\n  offeringType: 'IPO' as const"
  },
  {
    name: 'RIGHTS → segment: MAINBOARD + offeringType: RIGHTS',
    pattern: /category:\s*(['"])RIGHTS\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'MAINBOARD' as const,\n  offeringType: 'RIGHTS' as const"
  },
  {
    name: 'NCD → segment: MAINBOARD + offeringType: NCD',
    pattern: /category:\s*(['"])NCD\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'MAINBOARD' as const,\n  offeringType: 'NCD' as const"
  },
  {
    name: 'OFS → segment: MAINBOARD + offeringType: OFS',
    pattern: /category:\s*(['"])OFS\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'MAINBOARD' as const,\n  offeringType: 'OFS' as const"
  },
  {
    name: 'FPO → segment: MAINBOARD + offeringType: FPO',
    pattern: /category:\s*(['"])FPO\1(?:\s*as\s*const)?/g,
    replacement: "segment: 'MAINBOARD' as const,\n  offeringType: 'FPO' as const"
  }
];

let totalFilesChanged = 0;
let totalReplacements = 0;

files.forEach(file => {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;
    let fileReplacements = 0;

    replacements.forEach(({ pattern, replacement }) => {
      const matches = content.match(pattern);
      if (matches) {
        content = content.replace(pattern, replacement);
        fileReplacements += matches.length;
      }
    });

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      totalFilesChanged++;
      totalReplacements += fileReplacements;
      const fileName = path.basename(file);
      console.log(`  ✅ ${fileName} (${fileReplacements} replacements)`);
    }
  } catch (error) {
    console.error(`  ❌ Error processing ${file}:`, error.message);
  }
});

console.log(`\n📊 Phase 1 Complete:`);
console.log(`   - Files updated: ${totalFilesChanged}`);
console.log(`   - Total replacements: ${totalReplacements}\n`);

// Phase 2: Fix Drizzle insert type errors in integration tests
console.log('🔧 Phase 2: Fixing Drizzle insert type assertions...\n');

const integrationDir = path.join(testDir, 'integration');
let integrationFiles = [];

try {
  const findIntCommand = process.platform === 'win32'
    ? `cd "${integrationDir}" && dir /s /b *.ts *.tsx`
    : `find "${integrationDir}" -type f \\( -name "*.ts" -o -name "*.tsx" \\)`;

  const output = execSync(findIntCommand, { encoding: 'utf8' });
  integrationFiles = output.trim().split('\n').filter(f => f.trim());
} catch (error) {
  console.log('No integration files found or error:', error.message);
}

let phase2Changes = 0;

integrationFiles.forEach(file => {
  try {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;

    // Fix segment type assertions for Drizzle insert
    content = content.replace(/segment:\s*'MAINBOARD'(?!\s*as)/g, "segment: 'MAINBOARD' as 'MAINBOARD' | 'SME'");
    content = content.replace(/segment:\s*'SME'(?!\s*as)/g, "segment: 'SME' as 'MAINBOARD' | 'SME'");

    // Fix offeringType assertions
    content = content.replace(/offeringType:\s*'IPO'(?!\s*as)/g, "offeringType: 'IPO' as const");
    content = content.replace(/offeringType:\s*'RIGHTS'(?!\s*as)/g, "offeringType: 'RIGHTS' as const");
    content = content.replace(/offeringType:\s*'NCD'(?!\s*as)/g, "offeringType: 'NCD' as const");
    content = content.replace(/offeringType:\s*'OFS'(?!\s*as)/g, "offeringType: 'OFS' as const");
    content = content.replace(/offeringType:\s*'FPO'(?!\s*as)/g, "offeringType: 'FPO' as const");

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      phase2Changes++;
      const fileName = path.basename(file);
      console.log(`  ✅ ${fileName}`);
    }
  } catch (error) {
    console.error(`  ❌ Error processing ${file}:`, error.message);
  }
});

console.log(`\n📊 Phase 2 Complete:`);
console.log(`   - Integration files fixed: ${phase2Changes}\n`);

console.log('✨ All replacements complete!\n');
console.log('📝 Summary:');
console.log(`   - Phase 1: ${totalFilesChanged} files, ${totalReplacements} replacements`);
console.log(`   - Phase 2: ${phase2Changes} integration files type-fixed`);
console.log(`   - Total files modified: ${totalFilesChanged + phase2Changes}\n`);
