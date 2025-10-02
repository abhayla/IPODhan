"""
Database Setup Script
Creates the ipodhan database and runs all migrations on the remote server
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

print(f"Loading environment from: {env_path}")
print(f"DB_HOST: {os.getenv('DB_HOST')}")
print(f"DB_PORT: {os.getenv('DB_PORT')}")
print(f"DB_NAME: {os.getenv('DB_NAME')}")


def create_database():
    """Create the ipodhan database if it doesn't exist"""

    # Connect to PostgreSQL server (to 'postgres' database)
    conn_params = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", 5432)),
        "database": "postgres",  # Connect to default postgres database
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", "postgres"),
    }

    print(
        f"\nConnecting to PostgreSQL server at {conn_params['host']}:{conn_params['port']}..."
    )

    try:
        # Connect to server
        conn = psycopg2.connect(**conn_params)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        db_name = os.getenv("DB_NAME", "ipodhan")

        # Check if database exists
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
        exists = cursor.fetchone()

        if exists:
            print(f"[OK] Database '{db_name}' already exists")
        else:
            print(f"Creating database '{db_name}'...")
            cursor.execute(f"CREATE DATABASE {db_name}")
            print(f"[OK] Database '{db_name}' created successfully")

        cursor.close()
        conn.close()

        return True

    except Exception as e:
        print(f"[ERROR] Error creating database: {str(e)}")
        return False


def run_migrations():
    """Run all database migrations"""

    # Connect to ipodhan database
    conn_params = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", 5432)),
        "database": os.getenv("DB_NAME", "ipodhan"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", "postgres"),
    }

    print(f"\nConnecting to database '{conn_params['database']}'...")

    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()

        # Get migration files
        migrations_dir = (
            Path(__file__).parent.parent.parent
            / "infrastructure"
            / "database"
            / "migrations"
        )
        migration_files = sorted(migrations_dir.glob("*.sql"))

        print(f"\nFound {len(migration_files)} migration files")

        for migration_file in migration_files:
            print(f"\n{'='*60}")
            print(f"Running migration: {migration_file.name}")
            print(f"{'='*60}")

            # Read migration SQL
            with open(migration_file, "r", encoding="utf-8") as f:
                migration_sql = f.read()

            # Execute migration
            cursor.execute(migration_sql)
            conn.commit()

            print(f"[OK] Migration {migration_file.name} completed successfully")

        cursor.close()
        conn.close()

        print(f"\n{'='*60}")
        print("[OK] All migrations completed successfully!")
        print(f"{'='*60}")

        return True

    except Exception as e:
        print(f"[ERROR] Error running migrations: {str(e)}")
        import traceback

        traceback.print_exc()
        return False


def verify_setup():
    """Verify database setup by checking tables"""

    conn_params = {
        "host": os.getenv("DB_HOST", "localhost"),
        "port": int(os.getenv("DB_PORT", 5432)),
        "database": os.getenv("DB_NAME", "ipodhan"),
        "user": os.getenv("DB_USER", "postgres"),
        "password": os.getenv("DB_PASSWORD", "postgres"),
    }

    print("\nVerifying database setup...")

    try:
        conn = psycopg2.connect(**conn_params)
        cursor = conn.cursor()

        # Check tables
        cursor.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            ORDER BY table_name
        """
        )

        tables = cursor.fetchall()

        print(f"\n[OK] Found {len(tables)} tables:")
        for table in tables:
            print(f"  - {table[0]}")

        # Expected tables
        expected_tables = [
            "ipos",
            "ipo_details",
            "ipo_financials",
            "ipo_scores",
            "gmp_history",
            "gmp_tracking",
            "pipeline_status",
            "subscription_data",
            "users",
            "user_watchlist",
            "api_keys",
        ]

        existing_table_names = [t[0] for t in tables]
        missing_tables = [t for t in expected_tables if t not in existing_table_names]

        if missing_tables:
            print(f"\n[WARNING] Missing tables: {', '.join(missing_tables)}")
        else:
            print(f"\n[OK] All expected tables are present!")

        cursor.close()
        conn.close()

        return True

    except Exception as e:
        print(f"[ERROR] Error verifying setup: {str(e)}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("IPODhan Database Setup Script")
    print("=" * 60)

    # Step 1: Create database
    if not create_database():
        print("\n[ERROR] Database creation failed. Exiting.")
        sys.exit(1)

    # Step 2: Run migrations
    if not run_migrations():
        print("\n[ERROR] Migrations failed. Exiting.")
        sys.exit(1)

    # Step 3: Verify setup
    verify_setup()

    print("\n" + "=" * 60)
    print("[OK] Database setup completed successfully!")
    print("=" * 60)
