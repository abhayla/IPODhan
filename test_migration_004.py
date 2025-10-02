"""
Test Migration 004: Score Tracking Tables
Runs the migration and validates table creation
"""

import os
import sys
import psycopg2
from dotenv import load_dotenv

# Load environment variables
import pathlib
env_path = pathlib.Path(__file__).parent / 'ipodhan-data-pipeline' / '.env'
load_dotenv(env_path)

def test_migration():
    """Test migration 004"""
    print("=" * 60)
    print("Testing Migration 004: Score Tracking Tables")
    print("=" * 60)

    # Database connection
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST'),
            port=int(os.getenv('DB_PORT', 5432)),
            database=os.getenv('DB_NAME'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD')
        )
        conn.autocommit = True
        cursor = conn.cursor()
        print(f"[OK] Connected to database: {os.getenv('DB_NAME')} @ {os.getenv('DB_HOST')}")

    except Exception as e:
        print(f"[FAIL] Database connection failed: {e}")
        sys.exit(1)

    # Read migration file
    try:
        with open('infrastructure/database/migrations/004_score_tracking_tables.sql', 'r') as f:
            migration_sql = f.read()
        print("[OK] Migration file loaded")
    except Exception as e:
        print(f"[FAIL] Failed to read migration file: {e}")
        sys.exit(1)

    # Execute migration
    try:
        cursor.execute(migration_sql)
        print("[OK] Migration executed successfully")
    except Exception as e:
        print(f"[FAIL] Migration execution failed: {e}")
        conn.rollback()
        sys.exit(1)

    # Validate table creation
    tables_to_check = ['score_history', 'score_performance', 'ab_experiments']

    print("\n" + "=" * 60)
    print("Validating Table Creation")
    print("=" * 60)

    for table in tables_to_check:
        try:
            cursor.execute(f"""
                SELECT COUNT(*)
                FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = '{table}'
            """)
            count = cursor.fetchone()[0]

            if count == 1:
                print(f"[OK] Table '{table}' created successfully")

                # Check column count
                cursor.execute(f"""
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_name = '{table}'
                """)
                col_count = cursor.fetchone()[0]
                print(f"     Columns: {col_count}")
            else:
                print(f"[FAIL] Table '{table}' not found")
                sys.exit(1)

        except Exception as e:
            print(f"[FAIL] Error validating table '{table}': {e}")
            sys.exit(1)

    # Validate materialized view
    print("\n" + "=" * 60)
    print("Validating Materialized View")
    print("=" * 60)

    try:
        cursor.execute("""
            SELECT COUNT(*)
            FROM pg_matviews
            WHERE schemaname = 'public'
            AND matviewname = 'current_ipo_scores'
        """)
        count = cursor.fetchone()[0]

        if count == 1:
            print("[OK] Materialized view 'current_ipo_scores' created successfully")
        else:
            print("[FAIL] Materialized view 'current_ipo_scores' not found")
            sys.exit(1)

    except Exception as e:
        print(f"[FAIL] Error validating materialized view: {e}")
        sys.exit(1)

    # Validate indexes
    print("\n" + "=" * 60)
    print("Validating Indexes")
    print("=" * 60)

    indexes_to_check = [
        'idx_score_history_ipo_time',
        'idx_score_history_version',
        'idx_score_performance_ipo',
        'idx_score_performance_analyzed',
        'idx_ab_experiments_status',
        'idx_current_ipo_scores_ipo',
        'idx_current_ipo_scores_verdict'
    ]

    for index in indexes_to_check:
        try:
            cursor.execute(f"""
                SELECT COUNT(*)
                FROM pg_indexes
                WHERE schemaname = 'public'
                AND indexname = '{index}'
            """)
            count = cursor.fetchone()[0]

            if count == 1:
                print(f"[OK] Index '{index}' created successfully")
            else:
                print(f"[FAIL] Index '{index}' not found")

        except Exception as e:
            print(f"[FAIL] Error validating index '{index}': {e}")

    # Close connection
    cursor.close()
    conn.close()

    print("\n" + "=" * 60)
    print("[SUCCESS] Migration 004 Test Complete - All Checks Passed!")
    print("=" * 60)

if __name__ == "__main__":
    test_migration()
