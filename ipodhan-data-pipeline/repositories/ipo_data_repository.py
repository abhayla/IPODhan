"""
IPO Data Repository
Data access layer for IPO, GMP, and pipeline status data
Implements repository pattern from AC4
"""

import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from psycopg2.extras import RealDictCursor

from repositories.db_config import get_db_connection

logger = logging.getLogger(__name__)


class IPODataRepository:
    """
    Repository for IPO data operations
    Implements AC4 requirements: upsert, duplicate checking, GMP tracking
    """

    def __init__(self):
        pass

    def upsert_ipo_details(self, ipo_data: Dict[str, Any]) -> str:
        """
        Insert or update IPO details
        AC4: Handle create/update logic with duplicate checking

        Args:
            ipo_data: IPO data dictionary

        Returns:
            IPO UUID as string
        """
        try:
            # First, check for duplicates
            existing_ipo = self.check_duplicate(ipo_data)

            if existing_ipo:
                # Update existing IPO
                ipo_id = existing_ipo['id']
                self._update_ipo(ipo_id, ipo_data)
                logger.info(f"Updated existing IPO: {ipo_id}")
                return str(ipo_id)
            else:
                # Insert new IPO
                ipo_id = self._insert_ipo(ipo_data)
                logger.info(f"Inserted new IPO: {ipo_id}")
                return str(ipo_id)

        except Exception as e:
            logger.error(f"Error upserting IPO details: {str(e)}", exc_info=True)
            raise

    def check_duplicate(self, ipo_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Check for duplicate IPO records
        AC4: Duplicate checking logic using ISIN and company name + dates

        Args:
            ipo_data: IPO data to check

        Returns:
            Existing IPO record if found, None otherwise
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    # Strategy 1: Check by ISIN (if available)
                    if 'isin' in ipo_data and ipo_data['isin']:
                        cursor.execute(
                            """
                            SELECT id.ipo_id as id, i.symbol, i.company_name, i.open_date, i.close_date
                            FROM ipo_details id
                            JOIN ipos i ON id.ipo_id = i.id
                            WHERE id.isin = %s
                            LIMIT 1
                            """,
                            (ipo_data['isin'],)
                        )
                        result = cursor.fetchone()
                        if result:
                            logger.info(f"Duplicate found by ISIN: {ipo_data['isin']}")
                            return dict(result)

                    # Strategy 2: Check by company name + dates
                    if 'company_name' in ipo_data and 'open_date' in ipo_data:
                        cursor.execute(
                            """
                            SELECT id, symbol, company_name, open_date, close_date
                            FROM ipos
                            WHERE LOWER(company_name) = LOWER(%s)
                            AND open_date = %s
                            LIMIT 1
                            """,
                            (ipo_data['company_name'], ipo_data['open_date'])
                        )
                        result = cursor.fetchone()
                        if result:
                            logger.info(f"Duplicate found by company name and date: {ipo_data['company_name']}")
                            return dict(result)

                    return None

        except Exception as e:
            logger.error(f"Error checking duplicate: {str(e)}", exc_info=True)
            return None

    def _insert_ipo(self, ipo_data: Dict[str, Any]) -> str:
        """Insert new IPO record into ipos table"""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                ipo_id = str(uuid.uuid4())

                cursor.execute(
                    """
                    INSERT INTO ipos (
                        id, symbol, company_name, issue_size, price_band_low, price_band_high,
                        lot_size, open_date, close_date, listing_date, status, category,
                        registrar, exchange, created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
                    )
                    """,
                    (
                        ipo_id,
                        ipo_data.get('symbol'),
                        ipo_data.get('company_name'),
                        ipo_data.get('issue_size'),
                        ipo_data.get('price_band_low'),
                        ipo_data.get('price_band_high'),
                        ipo_data.get('lot_size'),
                        ipo_data.get('open_date'),
                        ipo_data.get('close_date'),
                        ipo_data.get('listing_date'),
                        ipo_data.get('status', 'UPCOMING'),
                        ipo_data.get('category', 'MAINBOARD'),
                        ipo_data.get('registrar'),
                        ipo_data.get('exchange')
                    )
                )

                # Insert extended details if present
                if 'isin' in ipo_data or 'data_source' in ipo_data:
                    self._insert_ipo_details(cursor, ipo_id, ipo_data)

                return ipo_id

    def _update_ipo(self, ipo_id: str, ipo_data: Dict[str, Any]):
        """Update existing IPO record"""
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE ipos
                    SET symbol = %s, company_name = %s, issue_size = %s,
                        price_band_low = %s, price_band_high = %s, lot_size = %s,
                        open_date = %s, close_date = %s, listing_date = %s,
                        status = %s, category = %s, registrar = %s, exchange = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        ipo_data.get('symbol'),
                        ipo_data.get('company_name'),
                        ipo_data.get('issue_size'),
                        ipo_data.get('price_band_low'),
                        ipo_data.get('price_band_high'),
                        ipo_data.get('lot_size'),
                        ipo_data.get('open_date'),
                        ipo_data.get('close_date'),
                        ipo_data.get('listing_date'),
                        ipo_data.get('status'),
                        ipo_data.get('category'),
                        ipo_data.get('registrar'),
                        ipo_data.get('exchange'),
                        ipo_id
                    )
                )

                # Update or insert extended details
                if 'isin' in ipo_data or 'data_source' in ipo_data:
                    self._upsert_ipo_details(cursor, ipo_id, ipo_data)

    def _insert_ipo_details(self, cursor, ipo_id: str, details: Dict[str, Any]):
        """Insert extended IPO details"""
        cursor.execute(
            """
            INSERT INTO ipo_details (
                id, ipo_id, isin, company_description, issue_type, fresh_issue, ofs_issue,
                cut_off_price, face_value, min_investment, basis_of_allotment_date,
                initiation_of_refunds_date, credit_of_shares_date, registrar_link,
                lead_managers, exchanges, data_source, last_verified_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
            )
            """,
            (
                str(uuid.uuid4()),
                ipo_id,
                details.get('isin'),
                details.get('company_description'),
                details.get('issue_type'),
                details.get('fresh_issue'),
                details.get('ofs_issue'),
                details.get('cut_off_price'),
                details.get('face_value'),
                details.get('min_investment'),
                details.get('basis_of_allotment_date'),
                details.get('initiation_of_refunds_date'),
                details.get('credit_of_shares_date'),
                details.get('registrar_link'),
                details.get('lead_managers', []),
                details.get('exchanges', ['NSE', 'BSE']),
                details.get('data_source', 'MANUAL')
            )
        )

    def _upsert_ipo_details(self, cursor, ipo_id: str, details: Dict[str, Any]):
        """Update or insert IPO details"""
        cursor.execute(
            """
            INSERT INTO ipo_details (
                id, ipo_id, isin, company_description, issue_type, fresh_issue, ofs_issue,
                cut_off_price, face_value, min_investment, basis_of_allotment_date,
                initiation_of_refunds_date, credit_of_shares_date, registrar_link,
                lead_managers, exchanges, data_source, last_verified_at, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), NOW()
            )
            ON CONFLICT (ipo_id)
            DO UPDATE SET
                isin = EXCLUDED.isin,
                company_description = EXCLUDED.company_description,
                issue_type = EXCLUDED.issue_type,
                fresh_issue = EXCLUDED.fresh_issue,
                ofs_issue = EXCLUDED.ofs_issue,
                cut_off_price = EXCLUDED.cut_off_price,
                face_value = EXCLUDED.face_value,
                min_investment = EXCLUDED.min_investment,
                registrar_link = EXCLUDED.registrar_link,
                lead_managers = EXCLUDED.lead_managers,
                exchanges = EXCLUDED.exchanges,
                data_source = EXCLUDED.data_source,
                last_verified_at = NOW(),
                updated_at = NOW()
            """,
            (
                str(uuid.uuid4()),
                ipo_id,
                details.get('isin'),
                details.get('company_description'),
                details.get('issue_type'),
                details.get('fresh_issue'),
                details.get('ofs_issue'),
                details.get('cut_off_price'),
                details.get('face_value'),
                details.get('min_investment'),
                details.get('basis_of_allotment_date'),
                details.get('initiation_of_refunds_date'),
                details.get('credit_of_shares_date'),
                details.get('registrar_link'),
                details.get('lead_managers', []),
                details.get('exchanges', ['NSE', 'BSE']),
                details.get('data_source', 'MANUAL')
            )
        )

    def insert_gmp_record(self, gmp_data: Dict[str, Any]) -> str:
        """
        Insert new GMP history record
        AC4: GMP history tracking

        Args:
            gmp_data: GMP tracking data dictionary

        Returns:
            GMP record UUID as string
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    gmp_id = str(uuid.uuid4())

                    cursor.execute(
                        """
                        INSERT INTO gmp_tracking (
                            id, ipo_id, gmp_amount, gmp_percentage, expected_listing_price,
                            kostak_rate, subject_to_sauda, source, source_url,
                            confidence_score, recorded_at
                        ) VALUES (
                            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                        )
                        """,
                        (
                            gmp_id,
                            gmp_data.get('ipo_id'),
                            gmp_data.get('gmp_amount'),
                            gmp_data.get('gmp_percentage'),
                            gmp_data.get('expected_listing_price'),
                            gmp_data.get('kostak_rate'),
                            gmp_data.get('subject_to_sauda'),
                            gmp_data.get('source'),
                            gmp_data.get('source_url'),
                            gmp_data.get('confidence_score', 70),
                            gmp_data.get('recorded_at', datetime.now())
                        )
                    )

                    logger.info(f"Inserted GMP record: {gmp_id} for IPO: {gmp_data.get('ipo_id')}")
                    return gmp_id

        except Exception as e:
            logger.error(f"Error inserting GMP record: {str(e)}", exc_info=True)
            raise

    def refresh_gmp_materialized_view(self):
        """
        Refresh GMP current materialized view
        AC4: Materialized view refresh implementation
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT refresh_gmp_current_view()")
                    logger.info("GMP current materialized view refreshed successfully")

        except Exception as e:
            logger.error(f"Error refreshing GMP materialized view: {str(e)}", exc_info=True)
            raise

    def update_pipeline_status(self, source: str, pipeline_type: str, status: str,
                              records_processed: int = 0, records_inserted: int = 0,
                              records_updated: int = 0, execution_time_ms: int = 0,
                              error_message: str = None, error_details: dict = None):
        """
        Update pipeline status for monitoring
        AC6: Pipeline status tracking

        Args:
            source: Data source (NSE, BSE, IPOWATCH, etc.)
            pipeline_type: Type (IPO_DATA, GMP_DATA)
            status: Status (SUCCESS, FAILURE, RUNNING)
            records_processed: Number of records processed
            records_inserted: Number of records inserted
            records_updated: Number of records updated
            execution_time_ms: Execution time in milliseconds
            error_message: Error message if failed
            error_details: Additional error details as JSON
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cursor:
                    # Get current consecutive failures
                    cursor.execute(
                        """
                        SELECT consecutive_failures FROM pipeline_status
                        WHERE source = %s AND pipeline_type = %s
                        """,
                        (source, pipeline_type)
                    )
                    result = cursor.fetchone()
                    current_failures = result[0] if result else 0

                    # Update consecutive failures
                    if status == 'SUCCESS':
                        consecutive_failures = 0
                        last_success_at = 'NOW()'
                    else:
                        consecutive_failures = current_failures + 1
                        last_success_at = 'last_success_at'

                    cursor.execute(
                        f"""
                        INSERT INTO pipeline_status (
                            id, source, pipeline_type, status, last_run_at, last_success_at,
                            consecutive_failures, records_processed, records_inserted,
                            records_updated, execution_time_ms, error_message, error_details
                        ) VALUES (
                            %s, %s, %s, %s, NOW(), {last_success_at}, %s, %s, %s, %s, %s, %s, %s
                        )
                        ON CONFLICT (source, pipeline_type)
                        DO UPDATE SET
                            status = EXCLUDED.status,
                            last_run_at = EXCLUDED.last_run_at,
                            last_success_at = {last_success_at},
                            consecutive_failures = EXCLUDED.consecutive_failures,
                            records_processed = EXCLUDED.records_processed,
                            records_inserted = EXCLUDED.records_inserted,
                            records_updated = EXCLUDED.records_updated,
                            execution_time_ms = EXCLUDED.execution_time_ms,
                            error_message = EXCLUDED.error_message,
                            error_details = EXCLUDED.error_details
                        """,
                        (
                            str(uuid.uuid4()),
                            source,
                            pipeline_type,
                            status,
                            consecutive_failures,
                            records_processed,
                            records_inserted,
                            records_updated,
                            execution_time_ms,
                            error_message,
                            error_details
                        )
                    )

                    logger.info(f"Updated pipeline status: {source} - {pipeline_type} - {status}")

        except Exception as e:
            logger.error(f"Error updating pipeline status: {str(e)}", exc_info=True)
            raise

    def get_ipo_by_company_name(self, company_name: str) -> Optional[Dict[str, Any]]:
        """Get IPO by company name"""
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(
                        """
                        SELECT * FROM ipos
                        WHERE LOWER(company_name) = LOWER(%s)
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        (company_name,)
                    )
                    result = cursor.fetchone()
                    return dict(result) if result else None

        except Exception as e:
            logger.error(f"Error getting IPO by company name: {str(e)}", exc_info=True)
            return None

    def get_all_active_ipos(self) -> List[Dict[str, Any]]:
        """Get all active (UPCOMING, LIVE) IPOs"""
        try:
            with get_db_connection() as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                    cursor.execute(
                        """
                        SELECT * FROM ipos
                        WHERE status IN ('UPCOMING', 'LIVE')
                        ORDER BY open_date ASC
                        """
                    )
                    results = cursor.fetchall()
                    return [dict(row) for row in results]

        except Exception as e:
            logger.error(f"Error getting active IPOs: {str(e)}", exc_info=True)
            return []
