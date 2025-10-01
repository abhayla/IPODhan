"""
IPO Data Schemas using Pydantic
Provides type-safe data models and validation for IPO data pipeline
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional, List
from enum import Enum
from pydantic import BaseModel, Field, field_validator, model_validator


class IPOStatus(str, Enum):
    """IPO status enumeration"""
    UPCOMING = "UPCOMING"
    LIVE = "LIVE"
    CLOSED = "CLOSED"
    LISTED = "LISTED"


class IPOCategory(str, Enum):
    """IPO category enumeration"""
    MAINBOARD = "MAINBOARD"
    SME = "SME"


class IssueType(str, Enum):
    """Issue type enumeration"""
    BOOK_BUILDING = "BOOK_BUILDING"
    FIXED_PRICE = "FIXED_PRICE"
    HYBRID = "HYBRID"


class GMPSource(str, Enum):
    """GMP data source enumeration"""
    IPOWATCH = "IPOWATCH"
    INVESTORGAIN = "INVESTORGAIN"
    CHITTORGARH = "CHITTORGARH"
    MANUAL = "MANUAL"


class DataSource(str, Enum):
    """Data source enumeration"""
    NSE = "NSE"
    BSE = "BSE"
    MANUAL = "MANUAL"


# ============================================================================
# Core IPO Data Schema
# ============================================================================

class IPODataSchema(BaseModel):
    """
    Core IPO data schema matching the 'ipos' table
    Used for basic IPO information from NSE/BSE
    """
    symbol: str = Field(..., min_length=1, max_length=20, description="Stock symbol")
    company_name: str = Field(..., min_length=1, max_length=255, description="Company name")
    issue_size: Optional[Decimal] = Field(None, ge=0, description="Issue size in crores")
    price_band_low: Decimal = Field(..., gt=0, description="Lower price band")
    price_band_high: Decimal = Field(..., gt=0, description="Upper price band")
    lot_size: int = Field(..., gt=0, description="Minimum lot size")
    open_date: date = Field(..., description="IPO opening date")
    close_date: date = Field(..., description="IPO closing date")
    listing_date: Optional[date] = Field(None, description="Expected listing date")
    status: IPOStatus = Field(..., description="IPO status")
    category: IPOCategory = Field(..., description="IPO category")
    registrar: Optional[str] = Field(None, max_length=100, description="Registrar name")
    exchange: Optional[str] = Field(None, max_length=20, description="Exchange (NSE/BSE)")

    @field_validator("price_band_high")
    @classmethod
    def validate_price_band(cls, v: Decimal, info) -> Decimal:
        """Ensure price_band_high > price_band_low"""
        if "price_band_low" in info.data and v <= info.data["price_band_low"]:
            raise ValueError("price_band_high must be greater than price_band_low")
        return v

    @model_validator(mode="after")
    def validate_dates(self) -> "IPODataSchema":
        """Validate date logic: open_date < close_date < listing_date"""
        if self.close_date <= self.open_date:
            raise ValueError("close_date must be after open_date")

        if self.listing_date and self.listing_date <= self.close_date:
            raise ValueError("listing_date must be after close_date")

        return self

    class Config:
        json_schema_extra = {
            "example": {
                "symbol": "TESTIPO",
                "company_name": "Test Company Limited",
                "issue_size": 500.00,
                "price_band_low": 100.00,
                "price_band_high": 110.00,
                "lot_size": 150,
                "open_date": "2025-10-05",
                "close_date": "2025-10-08",
                "listing_date": "2025-10-15",
                "status": "UPCOMING",
                "category": "MAINBOARD",
                "registrar": "Link Intime India",
                "exchange": "NSE"
            }
        }


# ============================================================================
# Extended IPO Details Schema
# ============================================================================

class IPODetailsSchema(BaseModel):
    """
    Extended IPO details schema matching 'ipo_details' table
    Contains comprehensive IPO information
    """
    ipo_id: str = Field(..., description="Reference to IPO UUID")
    isin: Optional[str] = Field(None, max_length=12, min_length=12, description="ISIN code")
    company_description: Optional[str] = Field(None, description="Company description")
    issue_type: Optional[IssueType] = Field(None, description="Issue type")
    fresh_issue: Optional[Decimal] = Field(None, ge=0, description="Fresh issue amount in crores")
    ofs_issue: Optional[Decimal] = Field(None, ge=0, description="OFS amount in crores")
    cut_off_price: Optional[Decimal] = Field(None, gt=0, description="Cut-off price")
    face_value: Optional[Decimal] = Field(None, gt=0, description="Face value per share")
    min_investment: Optional[Decimal] = Field(None, gt=0, description="Minimum investment amount")
    basis_of_allotment_date: Optional[date] = Field(None, description="Basis of allotment date")
    initiation_of_refunds_date: Optional[date] = Field(None, description="Refunds initiation date")
    credit_of_shares_date: Optional[date] = Field(None, description="Credit of shares date")
    registrar_link: Optional[str] = Field(None, max_length=500, description="Registrar website link")
    lead_managers: Optional[List[str]] = Field(default_factory=list, description="Lead managers")
    exchanges: List[str] = Field(default_factory=lambda: ["NSE", "BSE"], description="Exchanges")
    data_source: DataSource = Field(..., description="Data source")

    @field_validator("isin")
    @classmethod
    def validate_isin_format(cls, v: Optional[str]) -> Optional[str]:
        """Validate ISIN format (12 characters, alphanumeric)"""
        if v and (len(v) != 12 or not v.isalnum()):
            raise ValueError("ISIN must be 12 alphanumeric characters")
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "ipo_id": "550e8400-e29b-41d4-a716-446655440000",
                "isin": "INE123A01012",
                "company_description": "Leading technology company",
                "issue_type": "BOOK_BUILDING",
                "fresh_issue": 300.00,
                "ofs_issue": 200.00,
                "cut_off_price": 105.00,
                "face_value": 10.00,
                "min_investment": 15000.00,
                "data_source": "NSE"
            }
        }


# ============================================================================
# IPO Financials Schema
# ============================================================================

class IPOFinancialsSchema(BaseModel):
    """
    IPO financial metrics schema matching 'ipo_financials' table
    Contains revenue, profit, and key financial ratios
    """
    ipo_id: str = Field(..., description="Reference to IPO UUID")
    revenue_fy1: Optional[Decimal] = Field(None, description="Revenue FY1 in crores")
    revenue_fy2: Optional[Decimal] = Field(None, description="Revenue FY2 in crores")
    revenue_fy3: Optional[Decimal] = Field(None, description="Revenue FY3 in crores")
    profit_fy1: Optional[Decimal] = Field(None, description="Profit FY1 in crores")
    profit_fy2: Optional[Decimal] = Field(None, description="Profit FY2 in crores")
    profit_fy3: Optional[Decimal] = Field(None, description="Profit FY3 in crores")
    pe_ratio: Optional[Decimal] = Field(None, ge=0, description="Price to Earnings ratio")
    pb_ratio: Optional[Decimal] = Field(None, ge=0, description="Price to Book ratio")
    roe_percentage: Optional[Decimal] = Field(None, description="Return on Equity %")
    roce_percentage: Optional[Decimal] = Field(None, description="Return on Capital Employed %")
    debt_to_equity: Optional[Decimal] = Field(None, ge=0, description="Debt to Equity ratio")
    industry_pe: Optional[Decimal] = Field(None, ge=0, description="Industry average PE")
    peer_companies: Optional[List[str]] = Field(default_factory=list, description="Peer companies")
    financial_year_end: Optional[str] = Field(None, max_length=10, description="Financial year end")

    class Config:
        json_schema_extra = {
            "example": {
                "ipo_id": "550e8400-e29b-41d4-a716-446655440000",
                "revenue_fy1": 1200.50,
                "revenue_fy2": 1500.75,
                "revenue_fy3": 1800.25,
                "profit_fy1": 150.00,
                "profit_fy2": 200.00,
                "profit_fy3": 250.00,
                "pe_ratio": 25.50,
                "pb_ratio": 3.20,
                "roe_percentage": 18.50,
                "roce_percentage": 20.00,
                "debt_to_equity": 0.50,
                "industry_pe": 28.00,
                "financial_year_end": "FY2024"
            }
        }


# ============================================================================
# GMP Tracking Schema
# ============================================================================

class GMPTrackingSchema(BaseModel):
    """
    GMP tracking schema matching 'gmp_tracking' table
    Enhanced GMP data with multiple sources and confidence scoring
    """
    ipo_id: str = Field(..., description="Reference to IPO UUID")
    gmp_amount: Decimal = Field(..., ge=0, description="Absolute GMP value")
    gmp_percentage: Decimal = Field(..., description="GMP as percentage")
    expected_listing_price: Optional[Decimal] = Field(None, gt=0, description="Expected listing price")
    kostak_rate: Optional[Decimal] = Field(None, ge=0, description="Kostak rate (application selling)")
    subject_to_sauda: Optional[Decimal] = Field(None, ge=0, description="Subject to sauda price")
    source: GMPSource = Field(..., description="GMP data source")
    source_url: Optional[str] = Field(None, max_length=500, description="Source URL")
    confidence_score: int = Field(..., ge=1, le=100, description="Confidence score (1-100)")
    recorded_at: datetime = Field(default_factory=datetime.now, description="Recording timestamp")

    class Config:
        json_schema_extra = {
            "example": {
                "ipo_id": "550e8400-e29b-41d4-a716-446655440000",
                "gmp_amount": 50.00,
                "gmp_percentage": 45.45,
                "expected_listing_price": 160.00,
                "kostak_rate": 25.00,
                "subject_to_sauda": 55.00,
                "source": "IPOWATCH",
                "source_url": "https://www.ipowatch.in/",
                "confidence_score": 85
            }
        }


# ============================================================================
# Validation Result Schema
# ============================================================================

class ValidationResult(BaseModel):
    """
    Validation result wrapper
    Contains validation status and error messages
    """
    is_valid: bool = Field(..., description="Whether data is valid")
    errors: List[str] = Field(default_factory=list, description="List of validation errors")
    warnings: List[str] = Field(default_factory=list, description="List of warnings")
    data: Optional[dict] = Field(None, description="Validated and normalized data")

    class Config:
        json_schema_extra = {
            "example": {
                "is_valid": True,
                "errors": [],
                "warnings": ["Missing optional field: listing_date"],
                "data": {"symbol": "TESTIPO", "company_name": "Test Company"}
            }
        }
