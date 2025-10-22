import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

async function createPhase4Tables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Creating Phase 4 tables...\n');

    // Read and execute admin_settings migration
    const adminSettingsSql = fs.readFileSync(
      path.join(__dirname, '../drizzle/migrations/0019_add_admin_settings.sql'),
      'utf-8'
    );

    console.log('Creating admin_settings table...');
    await pool.query(adminSettingsSql);
    console.log('✅ admin_settings table created successfully\n');

    // Read and execute audit_logs migration
    const auditLogsSql = fs.readFileSync(
      path.join(__dirname, '../drizzle/migrations/0020_add_audit_logs.sql'),
      'utf-8'
    );

    console.log('Creating audit_logs table...');
    await pool.query(auditLogsSql);
    console.log('✅ audit_logs table created successfully\n');

    // Verify tables exist
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('admin_settings', 'audit_logs')
      ORDER BY table_name;
    `);

    console.log('Verification:');
    result.rows.forEach(row => {
      console.log(`  ✅ ${row.table_name} exists`);
    });

    console.log('\n✅ Phase 4 tables created successfully!');

  } catch (error) {
    console.error('❌ Error creating tables:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

createPhase4Tables().catch(console.error);
