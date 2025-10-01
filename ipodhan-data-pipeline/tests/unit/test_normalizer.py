"""
Unit Tests for Data Normalizer
AC2: Test normalization logic
"""

import pytest
from validators.normalizer import DataNormalizer


class TestDataNormalizer:
    """Test suite for DataNormalizer"""

    def setup_method(self):
        """Setup test fixture"""
        self.normalizer = DataNormalizer()

    def test_standardize_company_name(self):
        """Test company name standardization"""
        assert self.normalizer._standardize_company_name("Test Company Limited") == "Test Company"
        assert self.normalizer._standardize_company_name("ABC Pvt. Ltd.") == "ABC"
        assert self.normalizer._standardize_company_name("XYZ Private Limited") == "XYZ"

    def test_normalize_dates(self):
        """Test date normalization to ISO format"""
        data = {
            'open_date': '01-10-2025',
            'close_date': '05/10/2025',
        }

        normalized = self.normalizer._normalize_dates(data)

        assert normalized['open_date'] == '2025-10-01'
        assert normalized['close_date'] == '2025-10-05'

    def test_normalize_amount_with_crores(self):
        """Test amount normalization"""
        assert self.normalizer._normalize_amount('500 Crores') == 500
        assert self.normalizer._normalize_amount('₹1000 cr') == 1000
        assert self.normalizer._normalize_amount(250.5) == 250.5

    def test_normalize_amount_with_lakhs(self):
        """Test amount conversion from lakhs to crores"""
        assert self.normalizer._normalize_amount('100 lakhs') == 1.0  # 100 lakhs = 1 crore

    def test_normalize_price(self):
        """Test price normalization"""
        assert self.normalizer._normalize_price('₹100') == 100
        assert self.normalizer._normalize_price('1,250.50') == 1250.50
        assert self.normalizer._normalize_price(100) == 100

    def test_normalize_ipo_data_full(self):
        """Test full IPO data normalization"""
        raw_data = {
            'company_name': 'Test Company Limited',
            'open_date': '01-10-2025',
            'close_date': '05-10-2025',
            'price_band_low': '₹100',
            'price_band_high': '₹110',
            'issue_size': '500 crores',
            'lot_size': '150',
            'isin': 'ine123a01012',  # lowercase
            'status': 'upcoming',
            'category': 'mainboard'
        }

        normalized = self.normalizer.normalize_ipo_data(raw_data)

        assert normalized['company_name'] == 'Test Company'
        assert normalized['open_date'] == '2025-10-01'
        assert normalized['close_date'] == '2025-10-05'
        assert normalized['price_band_low'] == 100
        assert normalized['price_band_high'] == 110
        assert normalized['issue_size'] == 500
        assert normalized['lot_size'] == 150
        assert normalized['isin'] == 'INE123A01012'  # uppercase
        assert normalized['status'] == 'UPCOMING'
        assert normalized['category'] == 'MAINBOARD'

    def test_normalize_gmp_data(self):
        """Test GMP data normalization"""
        raw_gmp = {
            'ipo_id': '550e8400-e29b-41d4-a716-446655440000',
            'gmp_amount': '₹50',
            'gmp_percentage': '45%',
            'expected_listing_price': '₹160',
            'source': 'ipowatch'
        }

        normalized = self.normalizer.normalize_gmp_data(raw_gmp)

        assert normalized['gmp_amount'] == 50
        assert normalized['gmp_percentage'] == 45
        assert normalized['expected_listing_price'] == 160
        assert normalized['source'] == 'IPOWATCH'

    def test_calculate_derived_fields(self):
        """Test derived field calculation"""
        data = {
            'price_band_low': 100,
            'price_band_high': 110,
            'lot_size': 150
        }

        normalized = self.normalizer._calculate_derived_fields(data)

        assert 'issue_price_range' in normalized
        assert normalized['issue_price_range'] == '₹100 - ₹110'
        assert 'min_investment' in normalized
        assert normalized['min_investment'] == 15000  # 150 * 100


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
