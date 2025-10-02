"""
Integration Test for Full IPO Data Pipeline
Tests end-to-end flow: Scraping → Validation → Normalization → Storage
Requires database connection
"""

import pytest
import asyncio
from dotenv import load_dotenv
from datetime import date
from decimal import Decimal

# Load environment variables
load_dotenv()

from validators.ipo_validator import IPODataValidator
from validators.normalizer import DataNormalizer
from repositories.ipo_data_repository import IPODataRepository
from schemas.ipo_schema import IPOStatus, IPOCategory


class TestFullPipeline:
    """Integration tests for complete pipeline flow"""

    def setup_method(self):
        """Setup test fixture"""
        self.validator = IPODataValidator()
        self.normalizer = DataNormalizer()
        self.repository = IPODataRepository()

    def test_end_to_end_ipo_data_flow(self):
        """Test complete flow from raw data to database"""

        # Simulate raw scraped data
        raw_ipo_data = {
            "company_name": "Test Integration Company Limited",
            "symbol": "TESTINT",
            "open_date": "05-10-2025",
            "close_date": "08-10-2025",
            "listing_date": "15-10-2025",
            "price_band_low": "100",
            "price_band_high": "110",
            "lot_size": "150",
            "issue_size": "500 Cr",
            "status": "upcoming",
            "category": "mainboard",
            "registrar": "Link Intime",
            "exchange": "NSE",
        }

        # Step 1: Normalize data
        normalized_data = self.normalizer.normalize_ipo_data(raw_ipo_data)

        # Verify normalization
        assert (
            normalized_data["company_name"] == "Test Integration Company"
        )  # Suffix removed
        assert normalized_data["open_date"] == "2025-10-05"  # ISO format
        assert normalized_data["close_date"] == "2025-10-08"
        assert normalized_data["status"] == "UPCOMING"  # Uppercase
        assert normalized_data["category"] == "MAINBOARD"

        # Step 2: Validate normalized data
        validation_result = self.validator.validate_ipo_data(normalized_data)

        # Verify validation
        assert (
            validation_result.is_valid is True
        ), f"Validation errors: {validation_result.errors}"
        assert validation_result.data is not None

        # Step 3: Store in database
        ipo_id = self.repository.upsert_ipo_details(validation_result.data)

        # Verify storage
        assert ipo_id is not None
        assert len(ipo_id) > 0

        # Step 4: Retrieve and verify
        stored_ipo = self.repository.get_ipo_by_company_name("Test Integration Company")

        assert stored_ipo is not None
        assert stored_ipo["symbol"] == "TESTINT"
        assert stored_ipo["price_band_low"] == Decimal("100.00")
        assert stored_ipo["price_band_high"] == Decimal("110.00")

        print(f"[OK] End-to-end test passed. IPO ID: {ipo_id}")

    def test_gmp_data_flow(self):
        """Test GMP data flow"""

        # First, ensure we have an IPO in database
        ipo_data = {
            "company_name": "Test GMP Company",
            "symbol": "TESTGMP",
            "open_date": "2025-10-05",
            "close_date": "2025-10-08",
            "price_band_low": 100.00,
            "price_band_high": 110.00,
            "lot_size": 150,
            "status": "UPCOMING",
            "category": "MAINBOARD",
        }

        validation_result = self.validator.validate_ipo_data(ipo_data)
        ipo_id = self.repository.upsert_ipo_details(validation_result.data)

        # Now add GMP data
        raw_gmp_data = {
            "ipo_id": ipo_id,
            "gmp_amount": "50",
            "gmp_percentage": "45.45%",
            "expected_listing_price": 160.00,
            "source": "ipowatch",
            "confidence_score": 85,
        }

        # Normalize GMP data
        normalized_gmp = self.normalizer.normalize_gmp_data(raw_gmp_data)

        # Validate GMP data
        gmp_validation = self.validator.validate_gmp_data(normalized_gmp)
        assert gmp_validation.is_valid is True

        # Store GMP data
        gmp_id = self.repository.insert_gmp_record(gmp_validation.data)

        assert gmp_id is not None
        print(f"[OK] GMP data flow test passed. GMP ID: {gmp_id}")

    def test_duplicate_detection(self):
        """Test duplicate IPO detection"""

        ipo_data = {
            "company_name": "Duplicate Test Company",
            "symbol": "DUPTEST",
            "open_date": "2025-10-10",
            "close_date": "2025-10-12",
            "price_band_low": 200.00,
            "price_band_high": 220.00,
            "lot_size": 100,
            "status": "UPCOMING",
            "category": "MAINBOARD",
        }

        # Insert first time
        validation_result = self.validator.validate_ipo_data(ipo_data)
        ipo_id_1 = self.repository.upsert_ipo_details(validation_result.data)

        # Try to insert again (should update, not create new)
        ipo_data["price_band_high"] = 225.00  # Changed price
        validation_result2 = self.validator.validate_ipo_data(ipo_data)
        ipo_id_2 = self.repository.upsert_ipo_details(validation_result2.data)

        # Should be same ID (updated, not duplicated)
        assert ipo_id_1 == ipo_id_2

        # Verify updated data
        stored_ipo = self.repository.get_ipo_by_company_name("Duplicate Test Company")
        assert stored_ipo["price_band_high"] == Decimal("225.00")

        print(f"[OK] Duplicate detection test passed. Same ID: {ipo_id_1}")

    def test_pipeline_status_tracking(self):
        """Test pipeline status monitoring"""

        # Update pipeline status for successful run (use valid source from schema)
        self.repository.update_pipeline_status(
            source="NSE",  # Valid source from CHECK constraint
            pipeline_type="IPO_DATA",
            status="SUCCESS",
            records_processed=10,
            records_inserted=5,
            records_updated=5,
            execution_time_ms=2000,
        )

        # No exception means success
        print("[OK] Pipeline status tracking test passed")

    def test_materialized_view_refresh(self):
        """Test GMP materialized view refresh"""

        # Should not raise exception
        self.repository.refresh_gmp_materialized_view()

        print("[OK] Materialized view refresh test passed")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
