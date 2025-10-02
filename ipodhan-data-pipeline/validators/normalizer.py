"""
Data Normalizer
Normalizes and standardizes IPO data from various sources
"""

import logging
import re
from typing import Dict, Any
from datetime import datetime, date
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


class DataNormalizer:
    """
    Normalizes IPO data from different sources to a standard format
    Implements normalization rules from Story 1.2 AC2
    """

    def __init__(self):
        # Company name suffixes to remove for standardization
        self.company_suffixes = [
            "Limited",
            "Ltd",
            "Ltd.",
            "Private Limited",
            "Pvt Ltd",
            "Pvt. Ltd.",
            "Private",
            "Pvt",
            "Pvt.",
            "Public Limited Company",
            "PLC",
        ]

        # Amount unit conversions (to crores)
        self.amount_conversions = {
            "cr": 1,
            "crore": 1,
            "crores": 1,
            "lac": 0.01,
            "lakh": 0.01,
            "lakhs": 0.01,
            "million": 0.1,
            "mn": 0.1,
        }

    def normalize_ipo_data(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize IPO data to standard format

        Args:
            raw_data: Raw IPO data from scraper

        Returns:
            Normalized IPO data dictionary
        """
        normalized = raw_data.copy()

        try:
            # 1. Normalize dates to ISO format
            normalized = self._normalize_dates(normalized)

            # 2. Standardize company name
            if "company_name" in normalized:
                normalized["company_name"] = self._standardize_company_name(
                    normalized["company_name"]
                )

            # 3. Convert all amounts to crores
            amount_fields = ["issue_size", "fresh_issue", "ofs_issue", "min_investment"]
            for field in amount_fields:
                if field in normalized and normalized[field] is not None:
                    normalized[field] = self._normalize_amount(normalized[field])

            # 4. Normalize price fields
            price_fields = [
                "price_band_low",
                "price_band_high",
                "cut_off_price",
                "face_value",
            ]
            for field in price_fields:
                if field in normalized and normalized[field] is not None:
                    normalized[field] = self._normalize_price(normalized[field])

            # 5. Normalize lot size to integer
            if "lot_size" in normalized and normalized["lot_size"] is not None:
                normalized["lot_size"] = self._normalize_integer(normalized["lot_size"])

            # 6. Calculate derived fields
            normalized = self._calculate_derived_fields(normalized)

            # 7. Normalize text fields (trim, clean)
            normalized = self._normalize_text_fields(normalized)

            # 8. Normalize ISIN (uppercase, trim)
            if "isin" in normalized and normalized["isin"]:
                normalized["isin"] = normalized["isin"].strip().upper()

            # 9. Normalize status and category (uppercase)
            if "status" in normalized:
                normalized["status"] = normalized["status"].upper()
            if "category" in normalized:
                normalized["category"] = normalized["category"].upper()

            logger.debug(
                f"Normalized data for company: {normalized.get('company_name')}"
            )
            return normalized

        except Exception as e:
            logger.error(f"Error normalizing data: {str(e)}", exc_info=True)
            raise

    def normalize_gmp_data(self, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize GMP tracking data

        Args:
            raw_data: Raw GMP data from scraper

        Returns:
            Normalized GMP data dictionary
        """
        normalized = raw_data.copy()

        try:
            # Normalize GMP amounts
            if "gmp_amount" in normalized:
                normalized["gmp_amount"] = self._normalize_price(
                    normalized["gmp_amount"]
                )

            if (
                "expected_listing_price" in normalized
                and normalized["expected_listing_price"]
            ):
                normalized["expected_listing_price"] = self._normalize_price(
                    normalized["expected_listing_price"]
                )

            if "kostak_rate" in normalized and normalized["kostak_rate"]:
                normalized["kostak_rate"] = self._normalize_price(
                    normalized["kostak_rate"]
                )

            if "subject_to_sauda" in normalized and normalized["subject_to_sauda"]:
                normalized["subject_to_sauda"] = self._normalize_price(
                    normalized["subject_to_sauda"]
                )

            # Normalize GMP percentage
            if "gmp_percentage" in normalized:
                normalized["gmp_percentage"] = self._normalize_percentage(
                    normalized["gmp_percentage"]
                )

            # Ensure source is uppercase
            if "source" in normalized:
                normalized["source"] = normalized["source"].upper()

            return normalized

        except Exception as e:
            logger.error(f"Error normalizing GMP data: {str(e)}", exc_info=True)
            raise

    def _normalize_dates(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Convert dates to ISO format (YYYY-MM-DD)
        AC2: Date normalization requirement
        """
        date_fields = [
            "open_date",
            "close_date",
            "listing_date",
            "basis_of_allotment_date",
            "initiation_of_refunds_date",
            "credit_of_shares_date",
        ]

        for field in date_fields:
            if field in data and data[field] is not None:
                data[field] = self._parse_and_format_date(data[field])

        return data

    def _parse_and_format_date(self, date_value: Any) -> str:
        """Parse date from various formats and return ISO format string"""
        if isinstance(date_value, date):
            return date_value.isoformat()
        elif isinstance(date_value, str):
            # Try parsing common date formats
            date_formats = [
                "%Y-%m-%d",  # 2025-10-01
                "%d-%m-%Y",  # 01-10-2025
                "%d/%m/%Y",  # 01/10/2025
                "%d %b %Y",  # 01 Oct 2025
                "%d %B %Y",  # 01 October 2025
                "%B %d, %Y",  # October 01, 2025
                "%b %d, %Y",  # Oct 01, 2025
            ]

            for fmt in date_formats:
                try:
                    parsed_date = datetime.strptime(date_value.strip(), fmt).date()
                    return parsed_date.isoformat()
                except ValueError:
                    continue

            logger.warning(f"Unable to parse date: {date_value}, returning as-is")
            return date_value
        else:
            logger.warning(f"Unknown date type: {type(date_value)}, returning as-is")
            return str(date_value)

    def _standardize_company_name(self, name: str) -> str:
        """
        Standardize company name by removing suffixes
        AC2: Company name standardization requirement
        """
        if not name:
            return name

        # Trim whitespace
        name = name.strip()

        # Remove common suffixes (case-insensitive)
        for suffix in self.company_suffixes:
            # Use regex for whole word matching
            pattern = r"\b" + re.escape(suffix) + r"\b\.?$"
            name = re.sub(pattern, "", name, flags=re.IGNORECASE).strip()

        return name

    def _normalize_amount(self, amount: Any) -> Decimal:
        """
        Convert amount to crores
        AC2: Amount normalization requirement
        """
        if isinstance(amount, Decimal):
            return amount
        elif isinstance(amount, (int, float)):
            return Decimal(str(amount))
        elif isinstance(amount, str):
            # Extract numeric value and unit
            amount_str = amount.strip().lower()

            # Remove currency symbols and commas
            amount_str = re.sub(r"[₹$,]", "", amount_str)

            # Extract number and unit
            match = re.match(r"([\d.]+)\s*([a-z]*)", amount_str)
            if match:
                value = Decimal(match.group(1))
                unit = match.group(2) or "cr"  # Default to crores

                # Convert to crores based on unit
                conversion_factor = self.amount_conversions.get(unit, 1)
                return value * Decimal(str(conversion_factor))

            # If no unit found, assume crores
            return Decimal(amount_str)
        else:
            raise ValueError(f"Cannot normalize amount: {amount}")

    def _normalize_price(self, price: Any) -> Decimal:
        """Normalize price to Decimal"""
        if isinstance(price, Decimal):
            return price
        elif isinstance(price, (int, float)):
            return Decimal(str(price))
        elif isinstance(price, str):
            # Remove currency symbols and commas
            price_str = re.sub(r"[₹$,]", "", price.strip())
            return Decimal(price_str)
        else:
            raise ValueError(f"Cannot normalize price: {price}")

    def _normalize_percentage(self, percentage: Any) -> Decimal:
        """Normalize percentage to Decimal"""
        if isinstance(percentage, Decimal):
            return percentage
        elif isinstance(percentage, (int, float)):
            return Decimal(str(percentage))
        elif isinstance(percentage, str):
            # Remove % symbol
            pct_str = percentage.strip().replace("%", "")
            return Decimal(pct_str)
        else:
            raise ValueError(f"Cannot normalize percentage: {percentage}")

    def _normalize_integer(self, value: Any) -> int:
        """Normalize value to integer"""
        if isinstance(value, int):
            return value
        elif isinstance(value, float):
            return int(value)
        elif isinstance(value, str):
            # Remove commas
            value_str = value.strip().replace(",", "")
            return int(value_str)
        else:
            raise ValueError(f"Cannot normalize integer: {value}")

    def _calculate_derived_fields(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculate derived fields
        AC2: Derived fields calculation requirement
        """
        try:
            # Calculate issue_price_range (if not present)
            if "price_band_low" in data and "price_band_high" in data:
                low = data["price_band_low"]
                high = data["price_band_high"]
                data["issue_price_range"] = f"₹{low} - ₹{high}"

            # Calculate min_investment if not present (lot_size * price_band_low)
            if "min_investment" not in data or not data["min_investment"]:
                if "lot_size" in data and "price_band_low" in data:
                    lot_size = Decimal(str(data["lot_size"]))
                    price_low = Decimal(str(data["price_band_low"]))
                    data["min_investment"] = lot_size * price_low

            # Calculate total issue size (fresh + OFS)
            if "fresh_issue" in data and "ofs_issue" in data:
                if data["fresh_issue"] and data["ofs_issue"]:
                    fresh = Decimal(str(data["fresh_issue"]))
                    ofs = Decimal(str(data["ofs_issue"]))
                    if "issue_size" not in data or not data["issue_size"]:
                        data["issue_size"] = fresh + ofs

        except Exception as e:
            logger.warning(f"Error calculating derived fields: {str(e)}")

        return data

    def _normalize_text_fields(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize text fields (trim, clean whitespace)"""
        text_fields = [
            "company_name",
            "symbol",
            "registrar",
            "exchange",
            "company_description",
            "registrar_link",
        ]

        for field in text_fields:
            if field in data and isinstance(data[field], str):
                # Trim and clean multiple whitespaces
                data[field] = " ".join(data[field].split())

        return data
