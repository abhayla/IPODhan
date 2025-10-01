"""
IPO Data Validator
Validates scraped IPO data against business rules and schema requirements
"""

import logging
from typing import Dict, Any, List
from datetime import date
from decimal import Decimal, InvalidOperation
from pydantic import ValidationError

from schemas.ipo_schema import (
    IPODataSchema,
    IPODetailsSchema,
    IPOFinancialsSchema,
    GMPTrackingSchema,
    ValidationResult,
    IPOStatus,
    IPOCategory
)

logger = logging.getLogger(__name__)


class IPODataValidator:
    """
    Validator for IPO data from NSE/BSE sources
    Implements comprehensive validation rules from Story 1.2 AC2
    """

    def __init__(self):
        self.required_fields = [
            'company_name',
            'price_band_low',
            'price_band_high',
            'lot_size',
            'open_date',
            'close_date'
        ]

    def validate_ipo_data(self, raw_data: Dict[str, Any]) -> ValidationResult:
        """
        Validate IPO data against schema and business rules

        Args:
            raw_data: Raw IPO data dictionary from scraper

        Returns:
            ValidationResult with validation status and errors
        """
        errors = []
        warnings = []

        try:
            # 1. Check required fields presence
            missing_fields = self._check_required_fields(raw_data)
            if missing_fields:
                errors.append(f"Missing required fields: {', '.join(missing_fields)}")
                return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

            # 2. Validate date logic
            date_errors = self._validate_date_logic(raw_data)
            if date_errors:
                errors.extend(date_errors)

            # 3. Validate price band
            price_errors = self._validate_price_band(raw_data)
            if price_errors:
                errors.extend(price_errors)

            # 4. Validate lot size
            lot_size_errors = self._validate_lot_size(raw_data)
            if lot_size_errors:
                errors.extend(lot_size_errors)

            # 5. Validate issue size (if present)
            issue_size_errors = self._validate_issue_size(raw_data)
            if issue_size_errors:
                errors.extend(issue_size_errors)

            # 6. Validate with Pydantic schema
            if not errors:
                try:
                    validated_data = IPODataSchema(**raw_data)
                    return ValidationResult(
                        is_valid=True,
                        errors=[],
                        warnings=warnings,
                        data=validated_data.model_dump()
                    )
                except ValidationError as e:
                    for error in e.errors():
                        field = '.'.join(str(loc) for loc in error['loc'])
                        errors.append(f"{field}: {error['msg']}")

            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

        except Exception as e:
            logger.error(f"Unexpected error during validation: {str(e)}", exc_info=True)
            errors.append(f"Validation error: {str(e)}")
            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

    def validate_ipo_details(self, raw_data: Dict[str, Any]) -> ValidationResult:
        """
        Validate extended IPO details data

        Args:
            raw_data: Raw IPO details dictionary

        Returns:
            ValidationResult with validation status and errors
        """
        errors = []
        warnings = []

        try:
            # Validate ISIN format if present
            if 'isin' in raw_data and raw_data['isin']:
                if not self._validate_isin(raw_data['isin']):
                    errors.append("ISIN must be 12 alphanumeric characters")

            # Validate positive amounts
            amount_fields = ['fresh_issue', 'ofs_issue', 'cut_off_price', 'face_value', 'min_investment']
            for field in amount_fields:
                if field in raw_data and raw_data[field] is not None:
                    try:
                        value = Decimal(str(raw_data[field]))
                        if value < 0:
                            errors.append(f"{field} must be positive")
                    except (InvalidOperation, ValueError):
                        errors.append(f"{field} must be a valid number")

            # Validate with Pydantic schema
            if not errors:
                try:
                    validated_data = IPODetailsSchema(**raw_data)
                    return ValidationResult(
                        is_valid=True,
                        errors=[],
                        warnings=warnings,
                        data=validated_data.model_dump()
                    )
                except ValidationError as e:
                    for error in e.errors():
                        field = '.'.join(str(loc) for loc in error['loc'])
                        errors.append(f"{field}: {error['msg']}")

            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

        except Exception as e:
            logger.error(f"Unexpected error during details validation: {str(e)}", exc_info=True)
            errors.append(f"Validation error: {str(e)}")
            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

    def validate_gmp_data(self, raw_data: Dict[str, Any]) -> ValidationResult:
        """
        Validate GMP tracking data

        Args:
            raw_data: Raw GMP data dictionary

        Returns:
            ValidationResult with validation status and errors
        """
        errors = []
        warnings = []

        try:
            # Check required GMP fields
            required_gmp_fields = ['ipo_id', 'gmp_amount', 'gmp_percentage', 'source', 'confidence_score']
            missing = [f for f in required_gmp_fields if f not in raw_data or raw_data[f] is None]
            if missing:
                errors.append(f"Missing required GMP fields: {', '.join(missing)}")
                return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

            # Validate confidence score range
            if 'confidence_score' in raw_data:
                score = raw_data['confidence_score']
                if not isinstance(score, int) or score < 1 or score > 100:
                    errors.append("confidence_score must be an integer between 1 and 100")

            # Validate positive GMP amount
            if 'gmp_amount' in raw_data:
                try:
                    gmp_amount = Decimal(str(raw_data['gmp_amount']))
                    if gmp_amount < 0:
                        errors.append("gmp_amount must be non-negative")
                except (InvalidOperation, ValueError):
                    errors.append("gmp_amount must be a valid number")

            # Validate with Pydantic schema
            if not errors:
                try:
                    validated_data = GMPTrackingSchema(**raw_data)
                    return ValidationResult(
                        is_valid=True,
                        errors=[],
                        warnings=warnings,
                        data=validated_data.model_dump()
                    )
                except ValidationError as e:
                    for error in e.errors():
                        field = '.'.join(str(loc) for loc in error['loc'])
                        errors.append(f"{field}: {error['msg']}")

            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

        except Exception as e:
            logger.error(f"Unexpected error during GMP validation: {str(e)}", exc_info=True)
            errors.append(f"Validation error: {str(e)}")
            return ValidationResult(is_valid=False, errors=errors, warnings=warnings)

    def _check_required_fields(self, data: Dict[str, Any]) -> List[str]:
        """Check for missing required fields"""
        missing = []
        for field in self.required_fields:
            if field not in data or data[field] is None or data[field] == '':
                missing.append(field)
        return missing

    def _validate_date_logic(self, data: Dict[str, Any]) -> List[str]:
        """
        Validate date logic: open_date < close_date < listing_date
        AC2: Date logic validation requirement
        """
        errors = []

        try:
            open_date = self._parse_date(data.get('open_date'))
            close_date = self._parse_date(data.get('close_date'))
            listing_date = self._parse_date(data.get('listing_date')) if data.get('listing_date') else None

            if open_date and close_date:
                if close_date <= open_date:
                    errors.append("close_date must be after open_date")

            if close_date and listing_date:
                if listing_date <= close_date:
                    errors.append("listing_date must be after close_date")

        except ValueError as e:
            errors.append(f"Date parsing error: {str(e)}")

        return errors

    def _validate_price_band(self, data: Dict[str, Any]) -> List[str]:
        """
        Validate price band: low < high
        AC2: Price band validation requirement
        """
        errors = []

        try:
            price_low = Decimal(str(data.get('price_band_low', 0)))
            price_high = Decimal(str(data.get('price_band_high', 0)))

            if price_low <= 0:
                errors.append("price_band_low must be positive")

            if price_high <= 0:
                errors.append("price_band_high must be positive")

            if price_low >= price_high:
                errors.append("price_band_high must be greater than price_band_low")

        except (InvalidOperation, ValueError):
            errors.append("Price band values must be valid numbers")

        return errors

    def _validate_lot_size(self, data: Dict[str, Any]) -> List[str]:
        """
        Validate lot size is positive integer
        AC2: Lot size validation requirement
        """
        errors = []

        try:
            lot_size = data.get('lot_size')
            if not isinstance(lot_size, int) or lot_size <= 0:
                errors.append("lot_size must be a positive integer")
        except (TypeError, ValueError):
            errors.append("lot_size must be a valid integer")

        return errors

    def _validate_issue_size(self, data: Dict[str, Any]) -> List[str]:
        """
        Validate issue size is positive number
        AC2: Issue size validation requirement
        """
        errors = []

        if 'issue_size' in data and data['issue_size'] is not None:
            try:
                issue_size = Decimal(str(data['issue_size']))
                if issue_size <= 0:
                    errors.append("issue_size must be positive")
            except (InvalidOperation, ValueError):
                errors.append("issue_size must be a valid number")

        return errors

    def _validate_isin(self, isin: str) -> bool:
        """Validate ISIN format (12 alphanumeric characters)"""
        return len(isin) == 12 and isin.isalnum()

    def _parse_date(self, date_value: Any) -> date:
        """Parse date from various formats"""
        if isinstance(date_value, date):
            return date_value
        elif isinstance(date_value, str):
            # Try parsing common date formats
            from datetime import datetime
            for fmt in ['%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y']:
                try:
                    return datetime.strptime(date_value, fmt).date()
                except ValueError:
                    continue
            raise ValueError(f"Unable to parse date: {date_value}")
        else:
            raise ValueError(f"Invalid date type: {type(date_value)}")
