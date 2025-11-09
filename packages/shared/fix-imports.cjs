/**
 * Fix .js imports in TypeScript source files
 * Removes .js extensions from relative and local imports
 */

const fs = require('fs');
const path = require('path');

function getAllTsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      getAllTsFiles(filePath, fileList);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

function fixImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Replace relative/local imports with .js extension
  const patterns = [
    // from '../path/file.js' -> from '../path/file'
    /from\s+(['"])(\.\..+?)\.js\1/g,
    // from './path/file.js' -> from './path/file'
    /from\s+(['"])(\..+?)\.js\1/g,
  ];

  patterns.forEach(pattern => {
    const newContent = content.replace(pattern, "from $1$2$1");
    if (newContent !== content) {
      modified = true;
      content = newContent;
    }
  });

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    return true;
  }

  return false;
}

// Main execution
const srcDir = path.join(__dirname, 'src');
console.log(`Scanning ${srcDir} for TypeScript files...\n`);

const tsFiles = getAllTsFiles(srcDir);
console.log(`Found ${tsFiles.length} TypeScript files\n`);

let fixedCount = 0;
tsFiles.forEach(file => {
  if (fixImportsInFile(file)) {
    fixedCount++;
  }
});

console.log(`\n📊 Summary:`);
console.log(`  Total files scanned: ${tsFiles.length}`);
console.log(`  Files modified: ${fixedCount}`);
console.log(`  Files unchanged: ${tsFiles.length - fixedCount}`);
