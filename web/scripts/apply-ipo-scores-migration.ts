import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
});

async function applyMigration() {
  const client = await pool.connect();

  try {
    console.log('Applying ipo_scores migration...');

    // Create enums if they don't exist
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."confidence_level" AS ENUM('HIGH', 'MEDIUM', 'LOW');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Created confidence_level enum');

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."ipo_verdict" AS ENUM('APPLY', 'CONSIDER', 'SKIP');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Created ipo_verdict enum');

    // Create ipo_scores table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS "ipo_scores" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "ipo_id" uuid NOT NULL,
        "total_score" integer NOT NULL,
        "fundamental_score" integer NOT NULL,
        "sentiment_score" integer NOT NULL,
        "subscription_score" integer NOT NULL,
        "sector_score" integer NOT NULL,
        "verdict" "ipo_verdict" NOT NULL,
        "confidence" "confidence_level" NOT NULL,
        "reasoning" text,
        "calculated_at" timestamp DEFAULT now() NOT NULL,
        "algorithm_version" varchar(50) NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "ipo_scores_ipo_id_unique" UNIQUE("ipo_id")
      );
    `);
    console.log('✓ Created ipo_scores table');

    // Add foreign key constraint
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "ipo_scores" ADD CONSTRAINT "ipo_scores_ipo_id_ipos_id_fk"
        FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Added foreign key constraint');

    console.log('\n✅ Migration applied successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration().catch(console.error);
