/**
 * Quick Consolidation Analysis
 * Analyzes field_sources and data_conflicts tables to validate shadow mode
 */

import { db } from '@ipodhan/shared';
import { sql } from 'drizzle-orm';

async function analyzeConsolidation() {
  console.log('=== SHADOW MODE CONSOLIDATION ANALYSIS ===\n');

  try {
    // 1. Total field sources tracked
    const fieldSourcesResult = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM field_sources`
    );
    const totalFieldSources = parseInt(fieldSourcesResult[0]?.count || '0');
    console.log(`✅ Total Field Sources Tracked: ${totalFieldSources}`);

    // 2. Count by source
    const sourceDistResult = await db.execute<{ source: string; count: string }>(
      sql`SELECT source, COUNT(*) as count FROM field_sources GROUP BY source ORDER BY count DESC`
    );
    console.log('\n📊 Field Sources by Scraper:');
    sourceDistResult.forEach(row => {
      console.log(`   ${row.source}: ${row.count} fields`);
    });

    // 3. Conflicts analysis
    const conflictsResult = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM data_conflicts`
    );
    const totalConflicts = parseInt(conflictsResult[0]?.count || '0');
    console.log(`\n⚔️  Total Conflicts Detected: ${totalConflicts}`);

    let conflictsBySeverity: Array<{ severity: string; count: string }> = [];
    if (totalConflicts > 0) {
      conflictsBySeverity = await db.execute<{ severity: string; count: string }>(
        sql`SELECT severity, COUNT(*) as count FROM data_conflicts GROUP BY severity`
      );
      console.log('   By Severity:');
      conflictsBySeverity.forEach(row => {
        const emoji = row.severity === 'CRITICAL' ? '🔴' : row.severity === 'WARNING' ? '🟡' : 'ℹ️';
        console.log(`     ${emoji} ${row.severity}: ${row.count}`);
      });
    }

    // 4. Recent consolidations (last 10 minutes)
    const recentResult = await db.execute<{
      ipo_id: string;
      source: string;
      fields_count: string;
    }>(
      sql`SELECT fs.ipo_id, fs.source, COUNT(DISTINCT fs.field_name) as fields_count
          FROM field_sources fs
          WHERE fs.updated_at > NOW() - INTERVAL '10 minutes'
          GROUP BY fs.ipo_id, fs.source
          ORDER BY MAX(fs.updated_at) DESC
          LIMIT 10`
    );

    console.log(`\n⏱️  Recent Consolidations (last 10 min): ${recentResult.length}`);
    if (recentResult.length > 0) {
      recentResult.forEach(row => {
        console.log(`   ${row.source}: ${row.fields_count} fields for IPO ${row.ipo_id.substring(0, 8)}...`);
      });
    }

    // 5. Unique IPOs consolidated
    const uniqueIPOsResult = await db.execute<{ count: string }>(
      sql`SELECT COUNT(DISTINCT ipo_id) as count FROM field_sources`
    );
    const uniqueIPOs = parseInt(uniqueIPOsResult[0]?.count || '0');
    console.log(`\n🎯 Unique IPOs Consolidated: ${uniqueIPOs}`);

    // 6. Go/No-Go Recommendation
    console.log('\n' + '='.repeat(60));
    console.log('🎯 PHASE 2 VALIDATION RESULTS:');
    console.log('='.repeat(60));

    const hasData = totalFieldSources > 0;
    const lowConflictRate = totalConflicts === 0 || (totalConflicts / totalFieldSources) < 0.05;
    const hasCritical = conflictsBySeverity.some(r => r.severity === 'CRITICAL');

    console.log(`\n✅ Field Source Tracking: ${hasData ? 'WORKING' : 'NOT WORKING'}`);
    console.log(`${lowConflictRate ? '✅' : '❌'} Conflict Rate: ${totalConflicts > 0 ? ((totalConflicts / totalFieldSources) * 100).toFixed(2) + '%' : '0%'} (Target: <5%)`);
    console.log(`${hasCritical ? '⚠️' : '✅'} Critical Conflicts: ${hasCritical ? 'YES - Review Required' : 'NONE'}`);

    console.log('\n' + '='.repeat(60));
    if (hasData && lowConflictRate && !hasCritical) {
      console.log('🟢 RECOMMENDATION: GO - Proceed to Phase 3 (Live Rollout)');
      console.log('   Shadow mode is working correctly. Ready for gradual rollout.');
    } else if (hasData && !hasCritical) {
      console.log('🟡 RECOMMENDATION: REVIEW - Proceed with caution');
      console.log('   Conflict rate slightly elevated. Review conflicts before rollout.');
    } else {
      console.log('🔴 RECOMMENDATION: NO-GO - Fix issues before proceeding');
      if (!hasData) console.log('   ❌ No field sources tracked - shadow mode not working');
      if (hasCritical) console.log('   ❌ Critical conflicts detected - review priority matrix');
    }
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error analyzing consolidation:', error);
  } finally {
    process.exit(0);
  }
}

analyzeConsolidation();
