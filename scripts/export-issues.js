#!/usr/bin/env node

/**
 * CSV Issue Export Script
 *
 * Exports issues from markdown files (TODO.md, ISSUES-TRACKER.md) to CSV format
 * for stakeholder reporting and external tool import.
 *
 * Usage: npm run export-issues
 */

const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  todoPath: path.join(__dirname, '../docs/10-issues/TODO.md'),
  trackerPath: path.join(__dirname, '../docs/10-issues/ISSUES-TRACKER.md'),
  outputPath: path.join(__dirname, '../docs/10-issues/exports/issues-export.csv'),
  defectReportsDir: path.join(__dirname, '../docs/07-testing/defect-reports'),
};

/**
 * Parse TODO.md file and extract issues
 */
function parseTodoFile(content) {
  const issues = [];
  const lines = content.split('\n');

  let currentPriority = 'Unknown';
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Detect priority section headers
    if (line.includes('🔴 P0')) {
      currentPriority = 'P0';
      currentSection = 'Critical';
    } else if (line.includes('🟠 P1')) {
      currentPriority = 'P1';
      currentSection = 'Major';
    } else if (line.includes('🟡 P2')) {
      currentPriority = 'P2';
      currentSection = 'Minor';
    } else if (line.includes('🟢 P3')) {
      currentPriority = 'P3';
      currentSection = 'Trivial';
    } else if (line.includes('✅ Completed')) {
      currentPriority = 'Completed';
      currentSection = 'Done';
    }

    // Parse issue line: - [ ] **#ISS-XXX**: Description
    const issueMatch = line.match(/^- \[([ x])\]\s+\*\*#(ISS-\d+|DEF-\d+-\d+)\*\*:\s+(.+)/);
    if (issueMatch) {
      const [, checked, id, description] = issueMatch;
      const status = checked === 'x' ? 'Completed' : 'Open';

      // Extract additional metadata from next lines
      let component = 'TBD';
      let assignee = 'TBD';
      let effort = 'TBD';
      let dueDate = 'TBD';

      // Look ahead for metadata (next 5 lines)
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const metaLine = lines[j].trim();
        if (metaLine.includes('**Component**:')) {
          component = metaLine.split(':')[1]?.trim() || 'TBD';
        } else if (metaLine.includes('**Assignee**:')) {
          assignee = metaLine.split(':')[1]?.trim() || 'TBD';
        } else if (metaLine.includes('**Effort**:')) {
          effort = metaLine.split(':')[1]?.trim() || 'TBD';
        } else if (metaLine.includes('**Due**:')) {
          dueDate = metaLine.split(':')[1]?.trim() || 'TBD';
        }
      }

      issues.push({
        id,
        priority: currentPriority,
        status,
        component,
        description: description.replace(/,/g, ';'), // Escape commas for CSV
        assignee,
        effort,
        dueDate,
        source: 'TODO.md'
      });
    }
  }

  return issues;
}

/**
 * Parse defect reports from defect-reports directory
 */
function parseDefectReports() {
  const defects = [];

  if (!fs.existsSync(CONFIG.defectReportsDir)) {
    return defects;
  }

  const files = fs.readdirSync(CONFIG.defectReportsDir);

  for (const file of files) {
    if (file.endsWith('.md')) {
      const filePath = path.join(CONFIG.defectReportsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Extract metadata from defect report
      const idMatch = content.match(/\*\*ID\*\*:\s*([A-Z]+-\d+-\d+)/);
      const severityMatch = content.match(/\*\*Severity\*\*:\s*(P[0-3])/);
      const statusMatch = content.match(/\*\*Status\*\*:\s*(\w+)/);
      const componentMatch = content.match(/\*\*Component\*\*:\s*([^\n]+)/);
      const titleMatch = content.match(/^#\s+Defect Report:\s+(.+)$/m);

      if (idMatch) {
        defects.push({
          id: idMatch[1],
          priority: severityMatch ? severityMatch[1] : 'Unknown',
          status: statusMatch ? statusMatch[1] : 'Unknown',
          component: componentMatch ? componentMatch[1].trim() : 'Unknown',
          description: titleMatch ? titleMatch[1].replace(/,/g, ';') : 'Unknown',
          assignee: 'TBD',
          effort: 'TBD',
          dueDate: 'TBD',
          source: `defect-reports/${file}`
        });
      }
    }
  }

  return defects;
}

/**
 * Generate CSV content from issues
 */
function generateCSV(issues) {
  const headers = ['ID', 'Priority', 'Status', 'Component', 'Description', 'Assignee', 'Effort', 'Due Date', 'Source'];
  const rows = [headers.join(',')];

  for (const issue of issues) {
    const row = [
      issue.id,
      issue.priority,
      issue.status,
      issue.component,
      `"${issue.description}"`, // Quoted for CSV
      issue.assignee,
      issue.effort,
      issue.dueDate,
      issue.source
    ];
    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * Main export function
 */
function exportIssues() {
  console.log('📊 IPODhan Issue Export Tool\n');

  try {
    // Read TODO.md
    console.log('Reading TODO.md...');
    if (!fs.existsSync(CONFIG.todoPath)) {
      console.error(`❌ Error: TODO.md not found at ${CONFIG.todoPath}`);
      process.exit(1);
    }
    const todoContent = fs.readFileSync(CONFIG.todoPath, 'utf-8');
    const todoIssues = parseTodoFile(todoContent);
    console.log(`✅ Found ${todoIssues.length} issues in TODO.md`);

    // Read defect reports
    console.log('\nReading defect reports...');
    const defects = parseDefectReports();
    console.log(`✅ Found ${defects.length} defect reports`);

    // Combine all issues
    const allIssues = [...todoIssues, ...defects];
    console.log(`\n📝 Total issues: ${allIssues.length}`);

    // Generate CSV
    console.log('\nGenerating CSV...');
    const csv = generateCSV(allIssues);

    // Ensure output directory exists
    const outputDir = path.dirname(CONFIG.outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write CSV file
    fs.writeFileSync(CONFIG.outputPath, csv);
    console.log(`✅ Exported to: ${CONFIG.outputPath}`);

    // Print summary
    console.log('\n📊 Export Summary:');
    console.log('─'.repeat(50));

    const priorityCounts = {};
    const statusCounts = {};

    for (const issue of allIssues) {
      priorityCounts[issue.priority] = (priorityCounts[issue.priority] || 0) + 1;
      statusCounts[issue.status] = (statusCounts[issue.status] || 0) + 1;
    }

    console.log('\nBy Priority:');
    Object.entries(priorityCounts).forEach(([priority, count]) => {
      console.log(`  ${priority}: ${count}`);
    });

    console.log('\nBy Status:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });

    console.log('\n✅ Export complete!');

  } catch (error) {
    console.error('\n❌ Export failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run export
if (require.main === module) {
  exportIssues();
}

module.exports = { exportIssues, parseTodoFile, parseDefectReports, generateCSV };
