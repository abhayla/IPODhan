"""
Unit Tests for IPO Data Validator
AC2: Test validation logic
"""

import pytest
from datetime import date
from validators.ipo_validator import IPODataValidator
from schemas.ipo_schema import ValidationResult


class TestIPODataValidator:
    """Test suite for IPODataValidator"""

    def setup_method(self):
        """Setup test fixture"""
        self.validator = IPODataValidator()

    def test_validate_ipo_data_success(self):
        """Test successful IPO data validation"""
        valid_data = {
            'company_name': 'Test Company Limited',
            'symbol': 'TESTIPO',
            'open_date': '2025-10-05',
            'close_date': '2025-10-08',
            'listing_date': '2025-10-15',
            'price_band_low': 100.00,
            'price_band_high': 110.00,
            'lot_size': 150,
            'status': 'UPCOMING',
            'category': 'MAINBOARD'
        }

        result = self.validator.validate_ipo_data(valid_data)

        assert result.is_valid is True
        assert len(result.errors) == 0
        assert result.data is not None
        assert result.data['company_name'] == 'Test Company Limited'

    def test_validate_ipo_data_missing_required_fields(self):
        """Test validation fails with missing required fields"""
        invalid_data = {
            'company_name': 'Test Company',
            # Missing required fields
        }

        result = self.validator.validate_ipo_data(invalid_data)

        assert result.is_valid is False
        assert len(result.errors) > 0
        assert 'Missing required fields' in result.errors[0]

    def test_validate_ipo_data_invalid_dates(self):
        """Test validation fails with invalid date logic"""
        invalid_data = {
            'company_name': 'Test Company',
            'symbol': 'TEST',
            'open_date': '2025-10-08',
            'close_date': '2025-10-05',  # Close before open
            'price_band_low': 100.00,
            'price_band_high': 110.00,
            'lot_size': 150,
            'status': 'UPCOMING',
            'category': 'MAINBOARD'
        }

        result = self.validator.validate_ipo_data(invalid_data)

        assert result.is_valid is False
        assert any('close_date must be after open_date' in error for error in result.errors)

    def test_validate_ipo_data_invalid_price_band(self):
        """Test validation fails with invalid price band"""
        invalid_data = {
            'company_name': 'Test Company',
            'symbol': 'TEST',
            'open_date': '2025-10-05',
            'close_date': '2025-10-08',
            'price_band_low': 110.00,  # Low > High
            'price_band_high': 100.00,
            'lot_size': 150,
            'status': 'UPCOMING',
            'category': 'MAINBOARD'
        }

        result = self.validator.validate_ipo_data(invalid_data)

        assert result.is_valid is False
        assert any('price_band_high must be greater' in error for error in result.errors)

    def test_validate_ipo_data_invalid_lot_size(self):
        """Test validation fails with invalid lot size"""
        invalid_data = {
            'company_name': 'Test Company',
            'symbol': 'TEST',
            'open_date': '2025-10-05',
            'close_date': '2025-10-08',
            'price_band_low': 100.00,
            'price_band_high': 110.00,
            'lot_size': -10,  # Negative lot size
            'status': 'UPCOMING',
            'category': 'MAINBOARD'
        }

        result = self.validator.validate_ipo_data(invalid_data)

        assert result.is_valid is False
        assert any('lot_size must be a positive integer' in error for error in result.errors)

    def test_validate_gmp_data_success(self):
        """Test successful GMP data validation"""
        valid_gmp = {
            'ipo_id': '550e8400-e29b-41d4-a716-446655440000',
            'gmp_amount': 50.00,
            'gmp_percentage': 45.45,
            'expected_listing_price': 160.00,
            'source': 'IPOWATCH',
            'confidence_score': 85
        }

        result = self.validator.validate_gmp_data(valid_gmp)

        assert result.is_valid is True
        assert len(result.errors) == 0
        assert result.data['gmp_amount'] == 50.00

    def test_validate_gmp_data_invalid_confidence_score(self):
        """Test GMP validation fails with invalid confidence score"""
        invalid_gmp = {
            'ipo_id': '550e8400-e29b-41d4-a716-446655440000',
            'gmp_amount': 50.00,
            'gmp_percentage': 45.45,
            'source': 'IPOWATCH',
            'confidence_score': 150  # > 100
        }

        result = self.validator.validate_gmp_data(invalid_gmp)

        assert result.is_valid is False
        assert any('confidence_score' in error for error in result.errors)

    def test_validate_gmp_data_negative_gmp(self):
        """Test GMP validation fails with negative GMP amount"""
        invalid_gmp = {
            'ipo_id': '550e8400-e29b-41d4-a716-446655440000',
            'gmp_amount': -10.00,  # Negative
            'gmp_percentage': 45.45,
            'source': 'IPOWATCH',
            'confidence_score': 85
        }

        result = self.validator.validate_gmp_data(invalid_gmp)

        assert result.is_valid is False
        assert any('gmp_amount must be non-negative' in error for error in result.errors)


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
