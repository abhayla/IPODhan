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

# Check which schema contains pipeline_status
cursor.execute("""
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename = 'pipeline_status'
""")
result = cursor.fetchone()
print(f"Table found: {result}")

# List all tables
cursor.execute("""
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
""")
tables = cursor.fetchall()
print(f"\nAll public tables:")
for table in tables:
    print(f"  - {table[0]}.{table[1]}")

# Try to access pipeline_status with explicit schema
try:
    cursor.execute("SELECT COUNT(*) FROM public.pipeline_status")
    count = cursor.fetchone()[0]
    print(f"\n✅ public.pipeline_status exists with {count} rows")
except Exception as e:
    print(f"\n❌ Error accessing public.pipeline_status: {e}")

cursor.close()
conn.close()
