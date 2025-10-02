"""
Unit Tests for IPO Data Repository
AC4: Test repository methods with mocked database
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from decimal import Decimal
from datetime import datetime, date

from repositories.ipo_data_repository import IPODataRepository


class TestIPODataRepository:
    """Test suite for IPODataRepository"""

    def setup_method(self):
        """Setup test fixture"""
        self.repository = IPODataRepository()

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_check_duplicate_by_isin(self, mock_get_db):
        """Test duplicate checking by ISIN"""
        # Mock database connection and cursor
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Mock cursor return value
        mock_cursor.fetchone.return_value = {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "symbol": "TESTIPO",
            "company_name": "Test Company",
            "open_date": date(2025, 10, 5),
            "close_date": date(2025, 10, 8),
        }

        ipo_data = {
            "isin": "INE123A01012",
            "company_name": "Test Company Limited",
            "open_date": "2025-10-05",
        }

        result = self.repository.check_duplicate(ipo_data)

        assert result is not None
        assert result["id"] == "550e8400-e29b-41d4-a716-446655440000"
        mock_cursor.execute.assert_called_once()

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_check_duplicate_by_company_name_and_date(self, mock_get_db):
        """Test duplicate checking by company name and open date"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Only one query executed (no ISIN provided), returns match
        mock_cursor.fetchone.return_value = {
            "id": "550e8400-e29b-41d4-a716-446655440001",
            "symbol": "TESTIPO",
            "company_name": "Test Company",
            "open_date": date(2025, 10, 5),
            "close_date": date(2025, 10, 8),
        }

        ipo_data = {"company_name": "Test Company", "open_date": "2025-10-05"}

        result = self.repository.check_duplicate(ipo_data)

        assert result is not None
        assert result["company_name"] == "Test Company"
        assert mock_cursor.execute.call_count == 1

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_check_duplicate_no_match(self, mock_get_db):
        """Test duplicate checking when no match found"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Both checks return None
        mock_cursor.fetchone.return_value = None

        ipo_data = {"company_name": "New Company", "open_date": "2025-10-05"}

        result = self.repository.check_duplicate(ipo_data)

        assert result is None

    @patch("repositories.ipo_data_repository.get_db_connection")
    @patch("repositories.ipo_data_repository.uuid.uuid4")
    def test_insert_gmp_record(self, mock_uuid, mock_get_db):
        """Test inserting GMP record"""
        # Mock UUID
        mock_uuid.return_value = "550e8400-e29b-41d4-a716-446655440000"

        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        gmp_data = {
            "ipo_id": "550e8400-e29b-41d4-a716-446655440001",
            "gmp_amount": Decimal("50.00"),
            "gmp_percentage": Decimal("45.45"),
            "expected_listing_price": Decimal("160.00"),
            "source": "IPOWATCH",
            "confidence_score": 85,
            "recorded_at": datetime(2025, 10, 2, 10, 0, 0),
        }

        result = self.repository.insert_gmp_record(gmp_data)

        assert result == "550e8400-e29b-41d4-a716-446655440000"
        mock_cursor.execute.assert_called_once()

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_refresh_gmp_materialized_view(self, mock_get_db):
        """Test refreshing GMP materialized view"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Should not raise exception
        self.repository.refresh_gmp_materialized_view()

        mock_cursor.execute.assert_called_once_with("SELECT refresh_gmp_current_view()")

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_update_pipeline_status_success(self, mock_get_db):
        """Test updating pipeline status for successful run"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Mock consecutive failures query
        mock_cursor.fetchone.return_value = (0,)

        self.repository.update_pipeline_status(
            source="NSE",
            pipeline_type="IPO_DATA",
            status="SUCCESS",
            records_processed=10,
            records_inserted=5,
            records_updated=5,
            execution_time_ms=5000,
        )

        # Should execute SELECT and then INSERT/UPDATE
        assert mock_cursor.execute.call_count == 2

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_update_pipeline_status_failure(self, mock_get_db):
        """Test updating pipeline status for failed run"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        # Mock consecutive failures query
        mock_cursor.fetchone.return_value = (2,)  # 2 previous failures

        self.repository.update_pipeline_status(
            source="NSE",
            pipeline_type="IPO_DATA",
            status="FAILURE",
            error_message="Timeout error",
            execution_time_ms=30000,
        )

        # Should increment consecutive failures to 3
        assert mock_cursor.execute.call_count == 2

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_get_ipo_by_company_name(self, mock_get_db):
        """Test getting IPO by company name"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        mock_cursor.fetchone.return_value = {
            "id": "550e8400-e29b-41d4-a716-446655440000",
            "symbol": "TESTIPO",
            "company_name": "Test Company",
            "price_band_low": Decimal("100.00"),
            "price_band_high": Decimal("110.00"),
            "status": "UPCOMING",
        }

        result = self.repository.get_ipo_by_company_name("Test Company")

        assert result is not None
        assert result["company_name"] == "Test Company"
        mock_cursor.execute.assert_called_once()

    @patch("repositories.ipo_data_repository.get_db_connection")
    def test_get_all_active_ipos(self, mock_get_db):
        """Test getting all active IPOs"""
        # Mock database connection
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.__enter__.return_value = mock_conn
        mock_conn.__exit__.return_value = None
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = None
        mock_get_db.return_value = mock_conn

        mock_cursor.fetchall.return_value = [
            {"id": "1", "company_name": "IPO 1", "status": "UPCOMING"},
            {"id": "2", "company_name": "IPO 2", "status": "LIVE"},
        ]

        result = self.repository.get_all_active_ipos()

        assert len(result) == 2
        assert result[0]["status"] == "UPCOMING"
        assert result[1]["status"] == "LIVE"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
