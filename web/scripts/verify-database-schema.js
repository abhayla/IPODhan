#!/usr/bin/env node

/**
 * Verify Database Schema - Indexes and Foreign Keys
 * Tests against VPS PostgreSQL database
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function verifySchema() {
  console.log('🔍 Phase 1, Step 1: Database Schema Verification\n');
  console.log(`📍 VPS Database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();

    // 1. Verify Indexes
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1️⃣  INDEXES VERIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const indexesQuery = `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `;

    const indexesResult = await client.query(indexesQuery);

    if (indexesResult.rows.length === 0) {
      console.log('⚠️  NO INDEXES FOUND\n');
    } else {
      console.log(`✅ Found ${indexesResult.rows.length} indexes:\n`);

      let currentTable = '';
      indexesResult.rows.forEach((row) => {
        if (row.tablename !== currentTable) {
          if (currentTable !== '') console.log('');
          console.log(`📊 Table: ${row.tablename}`);
          currentTable = row.tablename;
        }
        console.log(`   └─ ${row.indexname}`);
      });
      console.log('');
    }

    // 2. Verify Foreign Keys
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('2️⃣  FOREIGN KEYS VERIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const fkQuery = `
      SELECT
        tc.table_name AS from_table,
        kcu.column_name AS from_column,
        ccu.table_name AS to_table,
        ccu.column_name AS to_column,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name;
    `;

    const fkResult = await client.query(fkQuery);

    if (fkResult.rows.length === 0) {
      console.log('⚠️  NO FOREIGN KEYS FOUND\n');
    } else {
      console.log(`✅ Found ${fkResult.rows.length} foreign key constraints:\n`);

      fkResult.rows.forEach((row, index) => {
        console.log(`${(index + 1).toString().padStart(2)}. ${row.from_table}.${row.from_column} → ${row.to_table}.${row.to_column}`);
        console.log(`    Constraint: ${row.constraint_name}`);
      });
      console.log('');
    }

    // 3. Verify Primary Keys
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('3️⃣  PRIMARY KEYS VERIFICATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const pkQuery = `
      SELECT
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
      ORDER BY tc.table_name;
    `;

    const pkResult = await client.query(pkQuery);

    if (pkResult.rows.length === 0) {
      console.log('❌ NO PRIMARY KEYS FOUND - CRITICAL ISSUE!\n');
    } else {
      console.log(`✅ Found ${pkResult.rows.length} primary keys:\n`);

      pkResult.rows.forEach((row, index) => {
        console.log(`${(index + 1).toString().padStart(2)}. ${row.table_name}.${row.column_name} (${row.constraint_name})`);
      });
      console.log('');
    }

    // 4. Check for Tables Without Primary Keys
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('4️⃣  TABLES WITHOUT PRIMARY KEYS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const noPkQuery = `
      SELECT t.tablename
      FROM pg_tables t
      LEFT JOIN (
        SELECT tc.table_name
        FROM information_schema.table_constraints tc
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
      ) pk ON t.tablename = pk.table_name
      WHERE t.schemaname = 'public'
        AND pk.table_name IS NULL
      ORDER BY t.tablename;
    `;

    const noPkResult = await client.query(noPkQuery);

    if (noPkResult.rows.length === 0) {
      console.log('✅ All tables have primary keys!\n');
    } else {
      console.log(`⚠️  ${noPkResult.rows.length} tables WITHOUT primary keys:\n`);
      noPkResult.rows.forEach((row, index) => {
        console.log(`${(index + 1).toString().padStart(2)}. ${row.tablename}`);
      });
      console.log('\n⚠️  This may be intentional for some tables (like junction tables)');
      console.log('');
    }

    client.release();

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 SCHEMA VERIFICATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(`✅ Indexes: ${indexesResult.rows.length}`);
    console.log(`✅ Foreign Keys: ${fkResult.rows.length}`);
    console.log(`✅ Primary Keys: ${pkResult.rows.length}`);
    console.log(`${noPkResult.rows.length > 0 ? '⚠️ ' : '✅'} Tables without PK: ${noPkResult.rows.length}`);
    console.log('');

    console.log('✅ Step 1: Database Schema Verification COMPLETE\n');

  } catch (error) {
    console.error('\n❌ ERROR during schema verification:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifySchema();
