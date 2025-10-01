"""
Database Connection Configuration
PostgreSQL connection pooling for data pipeline
"""

import os
import logging
from typing import Optional
from psycopg2 import pool, connect
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

# Global connection pool
_connection_pool: Optional[pool.SimpleConnectionPool] = None


def get_db_config() -> dict:
    """Get database configuration from environment variables"""
    return {
        'host': os.getenv('DB_HOST', 'localhost'),
        'port': int(os.getenv('DB_PORT', 5432)),
        'database': os.getenv('DB_NAME', 'ipodhan'),
        'user': os.getenv('DB_USER', 'postgres'),
        'password': os.getenv('DB_PASSWORD', 'postgres'),
    }


def get_db_pool() -> pool.SimpleConnectionPool:
    """
    Get or create database connection pool
    AC4: Connection pooling configuration for Python psycopg2
    """
    global _connection_pool

    if _connection_pool is None:
        try:
            config = get_db_config()
            min_conn = int(os.getenv('DB_POOL_MIN', 1))
            max_conn = int(os.getenv('DB_POOL_MAX', 10))

            logger.info(f"Creating database connection pool (min={min_conn}, max={max_conn})")

            _connection_pool = pool.SimpleConnectionPool(
                minconn=min_conn,
                maxconn=max_conn,
                **config
            )

            logger.info("Database connection pool created successfully")

        except Exception as e:
            logger.error(f"Failed to create database connection pool: {str(e)}", exc_info=True)
            raise

    return _connection_pool


def get_db_connection():
    """
    Get a connection from the pool
    Returns a context manager for automatic connection release
    """
    connection_pool = get_db_pool()

    class ConnectionContext:
        def __init__(self, pool):
            self.pool = pool
            self.connection = None

        def __enter__(self):
            self.connection = self.pool.getconn()
            return self.connection

        def __exit__(self, exc_type, exc_val, exc_tb):
            if self.connection:
                if exc_type is not None:
                    self.connection.rollback()
                else:
                    self.connection.commit()
                self.pool.putconn(self.connection)

    return ConnectionContext(connection_pool)


def close_db_pool():
    """Close all connections in the pool"""
    global _connection_pool

    if _connection_pool is not None:
        _connection_pool.closeall()
        _connection_pool = None
        logger.info("Database connection pool closed")


def execute_query(query: str, params: tuple = None, fetch_one: bool = False, fetch_all: bool = False):
    """
    Execute a database query with connection pooling

    Args:
        query: SQL query string
        params: Query parameters tuple
        fetch_one: Whether to fetch one result
        fetch_all: Whether to fetch all results

    Returns:
        Query result or None
    """
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(query, params)

            if fetch_one:
                return cursor.fetchone()
            elif fetch_all:
                return cursor.fetchall()
            else:
                return None
