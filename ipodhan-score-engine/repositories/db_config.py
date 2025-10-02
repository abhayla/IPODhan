"""
Database Configuration and Connection Pooling
Follows same pattern as ipodhan-data-pipeline
"""

import os
import logging
from psycopg2 import pool
from contextlib import contextmanager

logger = logging.getLogger(__name__)


class DatabaseConfig:
    """Database connection pool manager"""

    _connection_pool = None

    @classmethod
    def initialize_pool(cls):
        """Initialize database connection pool"""
        if cls._connection_pool is None:
            try:
                cls._connection_pool = pool.SimpleConnectionPool(
                    minconn=int(os.getenv("DB_POOL_MIN", 1)),
                    maxconn=int(os.getenv("DB_POOL_MAX", 10)),
                    host=os.getenv("DB_HOST"),
                    port=int(os.getenv("DB_PORT", 5432)),
                    database=os.getenv("DB_NAME"),
                    user=os.getenv("DB_USER"),
                    password=os.getenv("DB_PASSWORD"),
                )
                logger.info("Database connection pool initialized")
            except Exception as e:
                logger.error(f"Failed to initialize connection pool: {e}")
                raise

    @classmethod
    @contextmanager
    def get_connection(cls):
        """
        Context manager for database connections
        Usage:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM table")
        """
        if cls._connection_pool is None:
            cls.initialize_pool()

        conn = None
        try:
            conn = cls._connection_pool.getconn()
            yield conn
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Database operation failed: {e}")
            raise
        finally:
            if conn:
                cls._connection_pool.putconn(conn)

    @classmethod
    def close_pool(cls):
        """Close all connections in the pool"""
        if cls._connection_pool:
            cls._connection_pool.closeall()
            cls._connection_pool = None
            logger.info("Database connection pool closed")
