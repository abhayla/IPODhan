import { getDb } from '../lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { sql } from 'drizzle-orm';

async function createPhase4Tables() {
  try {
    console.log('Creating Phase 4 tables...\n');

    const db = await getDb();

    // Read and execute admin_settings migration
    const adminSettingsSql = fs.readFileSync(
      path.join(__dirname, '../drizzle/migrations/0019_add_admin_settings.sql'),
      'utf-8'
    );

    console.log('Creating admin_settings table...');
    await db.execute(sql.raw(adminSettingsSql));
    console.log('✅ admin_settings table created successfully\n');

    // Read and execute audit_logs migration
    const auditLogsSql = fs.readFileSync(
      path.join(__dirname, '../drizzle/migrations/0020_add_audit_logs.sql'),
      'utf-8'
    );

    console.log('Creating audit_logs table...');
    await db.execute(sql.raw(auditLogsSql));
    console.log('✅ audit_logs table created successfully\n');

    // Verify tables exist
    const result = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('admin_settings', 'audit_logs')
      ORDER BY table_name;
    `);

    console.log('Verification:');
    (result as any).rows.forEach((row: any) => {
      console.log(`  ✅ ${row.table_name} exists`);
    });

    console.log('\n✅ Phase 4 tables created successfully!');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  }
}

createPhase4Tables().catch(console.error);
