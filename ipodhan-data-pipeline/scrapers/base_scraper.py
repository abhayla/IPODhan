"""
Base scraper class for all web scrapers
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Any
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class BaseScraper(ABC):
    """Base scraper class that all scrapers should inherit from"""

    def __init__(self, source_name: str):
        self.source_name = source_name
        self.logger = logger

    @abstractmethod
    async def scrape(self) -> List[Dict[str, Any]]:
        """
        Scrape data from the source
        Returns a list of dictionaries containing scraped data
        """
        pass

    @abstractmethod
    def validate(self, data: Dict[str, Any]) -> bool:
        """
        Validate scraped data
        Returns True if data is valid, False otherwise
        """
        pass

    def log_success(self, count: int):
        """Log successful scraping"""
        self.logger.info(f"Successfully scraped {count} items from {self.source_name}")

    def log_error(self, error: Exception):
        """Log scraping error"""
        self.logger.error(f"Error scraping from {self.source_name}: {str(error)}")
