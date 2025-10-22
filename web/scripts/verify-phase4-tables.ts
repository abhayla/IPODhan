import { getDb } from '../lib/db';
import { sql } from 'drizzle-orm';

async function verifyTables() {
  try {
    const db = await getDb();

    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('audit_logs', 'admin_settings')
      ORDER BY table_name
    `);

    console.log('Phase 4 Tables Check:');
    console.log('====================');

    if ((result as any).rows.length === 0) {
      console.log('❌ No Phase 4 tables found!');
      console.log('\nTrying to query tables directly...');

      try {
        await db.execute(sql`SELECT COUNT(*) FROM admin_settings`);
        console.log('✅ admin_settings exists (direct query worked)');
      } catch (e) {
        console.log('❌ admin_settings does NOT exist');
      }

      try {
        await db.execute(sql`SELECT COUNT(*) FROM audit_logs`);
        console.log('✅ audit_logs exists (direct query worked)');
      } catch (e) {
        console.log('❌ audit_logs does NOT exist');
      }
    } else {
      (result as any).rows.forEach((row: any) => {
        console.log(`✅ ${row.table_name} exists`);
      });
    }

    console.log('\n✅ Verification complete');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

verifyTables();
