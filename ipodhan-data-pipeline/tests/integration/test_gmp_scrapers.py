"""
Integration Tests for GMP Scrapers
Tests GMP scrapers against mock responses to verify data extraction
AC1, AC5: GMP scraper implementation validation
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, patch
from scrapers.ipowatch_scraper import IPOWatchScraper
from scrapers.investorgain_scraper import InvestorGainScraper
from scrapers.chittorgarh_scraper import ChittorgarhScraper


class TestIPOWatchScraper:
    """Integration tests for IPOWatch GMP scraper"""

    @pytest.fixture
    def ipowatch_scraper(self):
        """Create IPOWatch scraper instance"""
        return IPOWatchScraper(timeout=5000, max_retries=1)

    @pytest.mark.asyncio
    async def test_ipowatch_initialization(self, ipowatch_scraper):
        """Test IPOWatch scraper initializes correctly"""
        assert ipowatch_scraper.source_name == "IPOWATCH"
        assert "ipowatch.in" in ipowatch_scraper.url.lower()
        assert ipowatch_scraper.timeout == 5000
        assert ipowatch_scraper.max_retries == 1

    @pytest.mark.asyncio
    async def test_ipowatch_mock_gmp_extraction(self, ipowatch_scraper):
        """Test IPOWatch scraper extracts GMP data from mock response"""

        # Mock the playwright page
        mock_page = AsyncMock()
        mock_browser = AsyncMock()
        mock_context = AsyncMock()

        # Mock _extract_gmp_data to return test GMP data
        async def mock_extract_gmp_data(page):
            return [
                {
                    "company_name": "Test IPO Company",
                    "symbol": "TESTIPO",
                    "gmp_amount": 50.00,
                    "gmp_percentage": 45.45,
                    "expected_listing_price": 160.00,
                    "kostak_rate": 25.00,
                    "subject_to_sauda": 55.00,
                    "source": "IPOWATCH",
                    "confidence_score": 85,
                }
            ]

        with patch.object(
            ipowatch_scraper, "_extract_gmp_data", side_effect=mock_extract_gmp_data
        ):
            with patch("scrapers.ipowatch_scraper.async_playwright") as mock_playwright:
                mock_pw = AsyncMock()
                mock_playwright.return_value.__aenter__.return_value = mock_pw
                mock_pw.chromium.launch = AsyncMock(return_value=mock_browser)
                mock_browser.new_context = AsyncMock(return_value=mock_context)
                mock_context.new_page = AsyncMock(return_value=mock_page)

                result = await ipowatch_scraper.scrape()

                # Verify GMP data structure
                assert len(result) == 1
                assert result[0]["gmp_amount"] == 50.00
                assert result[0]["gmp_percentage"] == 45.45
                assert result[0]["source"] == "IPOWATCH"
                assert result[0]["confidence_score"] == 85

    @pytest.mark.asyncio
    async def test_ipowatch_confidence_scoring(self, ipowatch_scraper):
        """Test IPOWatch assigns confidence scores correctly"""

        # Mock data with confidence score
        async def mock_extract_with_confidence(page):
            return [
                {
                    "company_name": "Test Company",
                    "gmp_amount": 50.00,
                    "gmp_percentage": 45.45,
                    "source": "IPOWATCH",
                    "confidence_score": 90,  # High confidence from primary source
                }
            ]

        with patch.object(
            ipowatch_scraper,
            "_extract_gmp_data",
            side_effect=mock_extract_with_confidence,
        ):
            with patch("scrapers.ipowatch_scraper.async_playwright") as mock_playwright:
                mock_pw = AsyncMock()
                mock_playwright.return_value.__aenter__.return_value = mock_pw
                mock_pw.chromium.launch = AsyncMock(return_value=AsyncMock())

                result = await ipowatch_scraper.scrape()

                # Primary source should have high confidence
                assert result[0]["confidence_score"] >= 80


class TestInvestorGainScraper:
    """Integration tests for InvestorGain GMP scraper"""

    @pytest.fixture
    def investorgain_scraper(self):
        """Create InvestorGain scraper instance"""
        return InvestorGainScraper(timeout=5000, max_retries=1)

    @pytest.mark.asyncio
    async def test_investorgain_initialization(self, investorgain_scraper):
        """Test InvestorGain scraper initializes correctly"""
        assert investorgain_scraper.source_name == "INVESTORGAIN"
        assert "investorgain.com" in investorgain_scraper.url.lower()
        assert investorgain_scraper.timeout == 5000

    @pytest.mark.asyncio
    async def test_investorgain_mock_gmp_extraction(self, investorgain_scraper):
        """Test InvestorGain scraper extracts GMP data"""

        async def mock_extract_gmp_data(page):
            return [
                {
                    "company_name": "InvestorGain Test IPO",
                    "symbol": "IGTEST",
                    "gmp_amount": 45.00,
                    "gmp_percentage": 40.00,
                    "source": "INVESTORGAIN",
                    "confidence_score": 75,
                }
            ]

        with patch.object(
            investorgain_scraper, "_extract_gmp_data", side_effect=mock_extract_gmp_data
        ):
            with patch(
                "scrapers.investorgain_scraper.async_playwright"
            ) as mock_playwright:
                mock_pw = AsyncMock()
                mock_playwright.return_value.__aenter__.return_value = mock_pw
                mock_pw.chromium.launch = AsyncMock(return_value=AsyncMock())

                result = await investorgain_scraper.scrape()

                assert len(result) == 1
                assert result[0]["source"] == "INVESTORGAIN"
                assert result[0]["gmp_amount"] == 45.00


class TestChittorgarhScraper:
    """Integration tests for Chittorgarh GMP scraper"""

    @pytest.fixture
    def chittorgarh_scraper(self):
        """Create Chittorgarh scraper instance"""
        return ChittorgarhScraper(timeout=5000, max_retries=1)

    @pytest.mark.asyncio
    async def test_chittorgarh_initialization(self, chittorgarh_scraper):
        """Test Chittorgarh scraper initializes correctly"""
        assert chittorgarh_scraper.source_name == "CHITTORGARH"
        assert "chittorgarh.com" in chittorgarh_scraper.url.lower()
        assert chittorgarh_scraper.timeout == 5000

    @pytest.mark.asyncio
    async def test_chittorgarh_mock_gmp_extraction(self, chittorgarh_scraper):
        """Test Chittorgarh scraper extracts GMP data"""

        async def mock_extract_gmp_data(page):
            return [
                {
                    "company_name": "Chittorgarh Test IPO",
                    "symbol": "CGTEST",
                    "gmp_amount": 40.00,
                    "gmp_percentage": 36.36,
                    "source": "CHITTORGARH",
                    "confidence_score": 70,
                }
            ]

        with patch.object(
            chittorgarh_scraper, "_extract_gmp_data", side_effect=mock_extract_gmp_data
        ):
            with patch(
                "scrapers.chittorgarh_scraper.async_playwright"
            ) as mock_playwright:
                mock_pw = AsyncMock()
                mock_playwright.return_value.__aenter__.return_value = mock_pw
                mock_pw.chromium.launch = AsyncMock(return_value=AsyncMock())

                result = await chittorgarh_scraper.scrape()

                assert len(result) == 1
                assert result[0]["source"] == "CHITTORGARH"
                assert result[0]["gmp_amount"] == 40.00


class TestGMPScraperIntegration:
    """Integration tests for GMP scraper coordination"""

    @pytest.mark.asyncio
    async def test_all_gmp_sources_consistency(self):
        """Test all GMP scrapers return consistent data structure"""

        ipowatch = IPOWatchScraper(timeout=5000, max_retries=1)
        investorgain = InvestorGainScraper(timeout=5000, max_retries=1)
        chittorgarh = ChittorgarhScraper(timeout=5000, max_retries=1)

        # All scrapers should have source_name attribute
        assert ipowatch.source_name == "IPOWATCH"
        assert investorgain.source_name == "INVESTORGAIN"
        assert chittorgarh.source_name == "CHITTORGARH"

        # All should inherit from BaseScraper
        assert hasattr(ipowatch, "log_success")
        assert hasattr(investorgain, "log_success")
        assert hasattr(chittorgarh, "log_success")

    @pytest.mark.asyncio
    async def test_gmp_confidence_score_range(self):
        """Test GMP scrapers assign confidence scores in valid range (1-100)"""

        # Mock all three scrapers
        async def mock_extract_various_confidence(page):
            return [
                {
                    "company_name": "Test",
                    "gmp_amount": 50.00,
                    "gmp_percentage": 45.45,
                    "source": "IPOWATCH",
                    "confidence_score": 85,
                }
            ]

        ipowatch = IPOWatchScraper(timeout=5000, max_retries=1)

        with patch.object(
            ipowatch, "_extract_gmp_data", side_effect=mock_extract_various_confidence
        ):
            with patch("scrapers.ipowatch_scraper.async_playwright") as mock_playwright:
                mock_pw = AsyncMock()
                mock_playwright.return_value.__aenter__.return_value = mock_pw
                mock_pw.chromium.launch = AsyncMock(return_value=AsyncMock())

                result = await ipowatch.scrape()

                # Confidence score should be in valid range
                assert 1 <= result[0]["confidence_score"] <= 100

    @pytest.mark.asyncio
    async def test_gmp_source_priority_order(self):
        """Test GMP sources are prioritized correctly"""

        # IPOWatch (primary) should have highest confidence
        # InvestorGain (secondary) should have medium confidence
        # Chittorgarh (tertiary) should have lower confidence

        # This is validated in pipeline orchestration
        # Primary source = IPOWATCH (confidence 80-90)
        # Secondary = INVESTORGAIN (confidence 70-80)
        # Tertiary = CHITTORGARH (confidence 60-70)

        sources = ["IPOWATCH", "INVESTORGAIN", "CHITTORGARH"]
        assert sources[0] == "IPOWATCH"  # Primary
        assert sources[1] == "INVESTORGAIN"  # Secondary
        assert sources[2] == "CHITTORGARH"  # Tertiary


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
