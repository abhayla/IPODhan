const fs = require('fs');
const path = require('path');

// Read TESTING_PLAN.md
const testingPlanPath = path.join(__dirname, '..', 'TESTING_PLAN.md');
const content = fs.readFileSync(testingPlanPath, 'utf-8');

const lines = content.split('\n');
const sqlBlocks = [];
let currentBlock = null;
let currentContext = '';
let inSqlBlock = false;
let blockNumber = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  if (line.trim() === '```sql') {
    // Starting a SQL block
    inSqlBlock = true;
    blockNumber++;

    // Capture context (look back for headers)
    let contextLines = [];
    for (let j = i - 1; j >= Math.max(0, i - 20); j--) {
      const prevLine = lines[j];
      if (prevLine.startsWith('#')) {
        contextLines.unshift(prevLine);
        break;
      }
      if (prevLine.trim().startsWith('**') && prevLine.trim().endsWith('**')) {
        contextLines.unshift(prevLine);
        break;
      }
    }

    currentContext = contextLines.join('\n');
    currentBlock = {
      number: blockNumber,
      context: currentContext,
      sql: '',
      lineStart: i + 1
    };
  } else if (line.trim() === '```' && inSqlBlock) {
    // Ending a SQL block
    inSqlBlock = false;
    currentBlock.lineEnd = i;
    sqlBlocks.push(currentBlock);
    currentBlock = null;
  } else if (inSqlBlock && currentBlock) {
    // Inside SQL block
    currentBlock.sql += line + '\n';
  }
}

console.log(`Extracted ${sqlBlocks.length} SQL query blocks\n`);

// Organize by phase/category - need to look at broader context
const categorized = {
  'Schema Verification': [],
  'Scraper Health & Monitoring': [],
  'Field Coverage Analysis': [],
  'GMP & Subscription Queries': [],
  'Historical Data Validation': [],
  'Scoring & Peer Comparison': [],
  'Repository Pattern Validation': [],
  'Performance Queries': [],
  'Safety & Approval': []
};

sqlBlocks.forEach(block => {
  const ctx = block.context.toLowerCase();
  const sql = block.sql.toLowerCase();

  // Check SQL content for better categorization
  if (ctx.includes('approval') || ctx.includes('forbidden') || sql.includes('insert into') || sql.includes('truncate')) {
    categorized['Safety & Approval'].push(block);
  } else if (ctx.includes('schema') || ctx.includes('verify indexes') || ctx.includes('foreign keys') ||
             sql.includes('pg_indexes') || sql.includes('\\dt')) {
    categorized['Schema Verification'].push(block);
  } else if (ctx.includes('scraper') || ctx.includes('pipeline') || ctx.includes('health') ||
             sql.includes('scraper_logs') || sql.includes('pipeline_status')) {
    categorized['Scraper Health & Monitoring'].push(block);
  } else if (ctx.includes('gmp') || ctx.includes('subscription') ||
             sql.includes('gmp_tracking') || sql.includes('gmp_history') || sql.includes('subscriptions')) {
    categorized['GMP & Subscription Queries'].push(block);
  } else if (ctx.includes('historical') || ctx.includes('listing_performance') || ctx.includes('listed ipos') ||
             sql.includes('listing_performance')) {
    categorized['Historical Data Validation'].push(block);
  } else if (ctx.includes('scoring') || ctx.includes('peer') || ctx.includes('ipo_scores') ||
             sql.includes('ipo_scores') || sql.includes('peer_companies')) {
    categorized['Scoring & Peer Comparison'].push(block);
  } else if (ctx.includes('coverage') || ctx.includes('field') || ctx.includes('null counts') ||
             sql.includes('count(company_name)') || sql.includes('coverage_percent')) {
    categorized['Field Coverage Analysis'].push(block);
  } else if (ctx.includes('repository') || ctx.includes('cache') || ctx.includes('performance') ||
             sql.includes('explain analyze')) {
    categorized['Repository Pattern Validation'].push(block);
  } else if (ctx.includes('performance') || sql.includes('execution') || sql.includes('duration')) {
    categorized['Performance Queries'].push(block);
  } else {
    // Default: try to categorize by table names in SQL
    if (sql.includes('listing_performance')) {
      categorized['Historical Data Validation'].push(block);
    } else if (sql.includes('ipo_scores') || sql.includes('peer_companies')) {
      categorized['Scoring & Peer Comparison'].push(block);
    } else if (sql.includes('gmp_') || sql.includes('subscription')) {
      categorized['GMP & Subscription Queries'].push(block);
    } else {
      categorized['Field Coverage Analysis'].push(block);
    }
  }
});

// Generate markdown
let markdown = `# Appendix B: SQL Queries Reference

**[← Back to Index](README.md)**

---

## Overview

This appendix contains all ${sqlBlocks.length} SQL queries extracted from the comprehensive testing plan. These queries are organized by testing phase and can be used for:

- Data validation during testing
- Database health checks
- Coverage analysis
- Performance monitoring
- Production data integrity verification

**⚠️ IMPORTANT**: All queries should be executed against the VPS production database at \`103.118.16.189:5432/ipodhan\` unless explicitly noted otherwise.

---

## Quick Index

${Object.entries(categorized).filter(([cat, blocks]) => blocks.length > 0).map(([cat, blocks]) => {
  const anchor = cat.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `- [${cat} (${blocks.length} queries)](#${anchor})`;
}).join('\n')}

---

`;

// Generate content for each category
Object.entries(categorized).forEach(([category, blocks]) => {
  if (blocks.length === 0) return;

  const anchor = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  markdown += `## ${category}\n\n`;
  markdown += `**Total Queries**: ${blocks.length}\n\n`;

  blocks.forEach((block, idx) => {
    markdown += `### Query ${idx + 1}: ${block.context.replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '').trim() || 'Untitled'}\n\n`;
    markdown += `**Source**: TESTING_PLAN.md (lines ${block.lineStart}-${block.lineEnd})\n\n`;

    if (block.context) {
      markdown += `**Context**:\n${block.context}\n\n`;
    }

    markdown += '```sql\n';
    markdown += block.sql.trim();
    markdown += '\n```\n\n';
    markdown += '---\n\n';
  });
});

// Add footer
markdown += `## Usage Notes

### Database Connection

**Before running any queries**, verify VPS database connection:

\`\`\`bash
# Check connection
node scripts/check-tables-exist.js

# Expected output:
# Connected to: 103.118.16.189:5432/ipodhan
\`\`\`

### Running Queries

**Option 1: Using psql**
\`\`\`bash
PGPASSWORD="<db-password>" psql -h 103.118.16.189 -p 5432 -U postgres -d ipodhan -f query.sql
\`\`\`

**Option 2: Using database tool**
- Connect to: \`103.118.16.189:5432/ipodhan\`
- Username: \`postgres\`
- Password: \`<db-password>\`

### Safety Guidelines

🔴 **PRODUCTION DATABASE** - All queries execute against live data

**Safe Operations** (no approval needed):
- ✅ SELECT queries (read-only)
- ✅ COUNT, SUM, AVG aggregations
- ✅ Table structure queries (\`\\dt\`, \`\\d tablename\`)

**Operations REQUIRING APPROVAL**:
- 🔒 INSERT, UPDATE, DELETE
- 🔒 TRUNCATE, DROP
- 🔒 ALTER TABLE
- 🔒 CREATE/DROP INDEX

**Best Practices**:
1. Test queries on smaller datasets first (add \`LIMIT\` clause)
2. Use \`EXPLAIN ANALYZE\` for performance analysis
3. Avoid long-running queries during peak hours
4. Monitor query execution time
5. Use transactions for any write operations

### Query Performance Targets

- Simple SELECT: < 100ms
- Aggregations: < 500ms
- Complex JOINs: < 1000ms
- Full table scans: Avoid if possible

---

**Generated**: ${new Date().toISOString()}
**Source**: web/TESTING_PLAN.md
**Total Queries**: ${sqlBlocks.length}
`;

// Write to file
const outputPath = path.join(__dirname, '..', '..', 'docs', '07-testing', 'test-plan', 'APPENDIX-B-SQL-QUERIES.md');
const outputDir = path.dirname(outputPath);

// Ensure directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, markdown, 'utf-8');

console.log(`✅ Generated: ${outputPath}`);
console.log(`\nBreakdown by category:`);
Object.entries(categorized).forEach(([cat, blocks]) => {
  if (blocks.length > 0) {
    console.log(`  ${cat}: ${blocks.length} queries`);
  }
});
