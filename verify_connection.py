import psycopg2

# Test connection
conn = psycopg2.connect(
    host='103.118.16.189',
    port=5432,
    database='ipodhan',
    user='postgres',
    password='***REMOVED-CREDENTIAL***'
)

cursor = conn.cursor()

# Check database name
cursor.execute("SELECT current_database()")
db_name = cursor.fetchone()[0]
print(f"Connected to database: {db_name}")

# Check PostgreSQL version
cursor.execute("SELECT version()")
version = cursor.fetchone()[0]
print(f"PostgreSQL version: {version}")

# List all databases
cursor.execute("SELECT datname FROM pg_database WHERE datistemplate = false")
databases = cursor.fetchall()
print(f"\nAvailable databases:")
for db in databases:
    print(f"  - {db[0]}")

# Count tables in current database
cursor.execute("""
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
""")
table_count = cursor.fetchone()[0]
print(f"\nTables in current database 'public' schema: {table_count}")

# Try listing some tables
cursor.execute("""
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
    LIMIT 20
""")
tables = cursor.fetchall()
if tables:
    print("\nTables found:")
    for table in tables:
        print(f"  - {table[0]}")
else:
    print("\nNo tables found in public schema")

cursor.close()
conn.close()
