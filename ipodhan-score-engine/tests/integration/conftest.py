"""
Shared fixtures for integration tests
Uses real IPO data from production database for safer testing
"""

import pytest
import uuid
import psycopg2
from dotenv import load_dotenv
import os
from datetime import datetime, timedelta

load_dotenv()


@pytest.fixture(scope="session")
def production_ipo_ids():
    """
    Get multiple real IPO IDs from production database for testing.
    Session-scoped so it only queries once for all tests.
    """
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )
    cursor = conn.cursor()

    # Get 10 real IPO IDs from production (use 'id' column which is the primary key)
    # Note: 'id' is the primary key, 'ipo_id' is a separate UUID field
    cursor.execute("SELECT id FROM ipo_details LIMIT 10")
    ipo_ids = [str(row[0]) for row in cursor.fetchall()]

    cursor.close()
    conn.close()

    if not ipo_ids:
        pytest.skip("No IPO data found in database. Cannot run integration tests.")

    return ipo_ids


@pytest.fixture
def test_ipo_id(production_ipo_ids):
    """
    Provides a real IPO ID from production for testing.
    Alias for compatibility with existing tests.
    """
    # Return first IPO ID (can be reused across tests)
    return production_ipo_ids[0]


@pytest.fixture
def fresh_test_ipo_id(production_ipo_ids, request):
    """
    Provides a real IPO ID from production and cleans up test data after each test.
    Uses different IPO IDs for different tests to minimize conflicts.
    """
    # Use test index to get different IPO IDs for different tests
    test_index = hash(request.node.nodeid) % len(production_ipo_ids)
    ipo_id = production_ipo_ids[test_index]

    # Track the time when test starts
    from datetime import timezone

    test_start_time = datetime.now(timezone.utc)

    yield ipo_id

    # Cleanup: Delete test scores created during this test
    # Only delete scores created in the last 5 minutes to be extra safe
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST"),
            port=os.getenv("DB_PORT"),
            database=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
        )
        cursor = conn.cursor()

        # Delete test scores created during this test
        # Use calculated_at timestamp to identify test data
        cutoff_time = test_start_time - timedelta(minutes=1)  # 1 min buffer

        cursor.execute(
            """
            DELETE FROM score_history
            WHERE ipo_id = %s
            AND calculated_at > %s
            """,
            (ipo_id, cutoff_time),
        )

        deleted_scores = cursor.rowcount

        # Also cleanup test performance records
        cursor.execute(
            """
            DELETE FROM score_performance
            WHERE ipo_id = %s
            AND created_at > %s
            """,
            (ipo_id, cutoff_time),
        )

        deleted_performance = cursor.rowcount

        conn.commit()
        cursor.close()
        conn.close()

        # Log cleanup (visible in verbose mode)
        if deleted_scores > 0 or deleted_performance > 0:
            print(
                f"\n[Cleanup] Deleted {deleted_scores} score records and {deleted_performance} performance records for IPO {ipo_id}"
            )

    except Exception as e:
        print(f"\n[Cleanup Warning] Failed to cleanup test data: {e}")
        # Don't fail the test if cleanup fails


@pytest.fixture(scope="session")
def cleanup_all_test_experiments():
    """
    Session-level fixture to cleanup test experiments at the end of all tests.
    Cleans up any experiments created during testing.
    """
    yield  # Tests run here

    # Cleanup after all tests complete
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST"),
            port=os.getenv("DB_PORT"),
            database=os.getenv("DB_NAME"),
            user=os.getenv("DB_USER"),
            password=os.getenv("DB_PASSWORD"),
        )
        cursor = conn.cursor()

        # Delete test experiments (experiments created in last 10 minutes)
        cursor.execute(
            """
            DELETE FROM ab_experiments
            WHERE created_at > NOW() - INTERVAL '10 minutes'
            AND name LIKE 'test_%'
            """
        )

        deleted_experiments = cursor.rowcount

        conn.commit()
        cursor.close()
        conn.close()

        if deleted_experiments > 0:
            print(f"\n[Session Cleanup] Deleted {deleted_experiments} test experiments")

    except Exception as e:
        print(f"\n[Session Cleanup Warning] Failed to cleanup experiments: {e}")


# Automatically use cleanup fixture for all tests in this module
@pytest.fixture(scope="session", autouse=True)
def auto_cleanup(cleanup_all_test_experiments):
    """Auto-applied fixture to ensure cleanup happens"""
    pass
