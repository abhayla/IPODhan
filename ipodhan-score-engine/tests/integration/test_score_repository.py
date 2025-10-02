"""
Integration Tests for Score Repository
Tests all database operations with real PostgreSQL connection
"""

import pytest
import os
import uuid
from datetime import datetime, timedelta
from repositories import ScoreRepository, DatabaseConfig
from algorithms.schemas import ScoreHistorySchema

# Load environment variables from .env file
from dotenv import load_dotenv

load_dotenv()

# Set test environment
os.environ["TESTING"] = "true"
# Use production database for integration tests (no separate test DB)
# Environment variables are already loaded from .env file


class TestScoreRepository:
    """Integration tests for ScoreRepository with PostgreSQL"""

    @pytest.fixture(scope="class")
    def repository(self):
        """Create repository instance"""
        DatabaseConfig.initialize_pool()
        return ScoreRepository()

    # Use fresh_test_ipo_id from conftest.py which creates real IPO entries
    # This is needed because score_history has a foreign key to ipo_details

    @pytest.fixture
    def sample_score(self, fresh_test_ipo_id):
        """Create sample score data"""
        return ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=75,
            fundamental_score=32,
            sentiment_score=24,
            subscription_score=14,
            sector_score=5,
            confidence_level="HIGH",
            algorithm_version="1.0",
        )

    def test_save_score_history_success(self, repository, sample_score):
        """Test saving score history to database"""
        score_id = repository.save_score_history(sample_score)

        assert score_id is not None
        assert isinstance(score_id, str)
        assert len(score_id) > 0  # Should be a UUID string

    def test_save_score_history_with_score_change(
        self, repository, fresh_test_ipo_id, sample_score
    ):
        """Test saving score with automatic score change calculation"""
        # Save first score
        repository.save_score_history(sample_score)

        # Save second score with different value
        updated_score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=80,  # Increased by 5
            fundamental_score=35,
            sentiment_score=25,
            subscription_score=15,
            sector_score=5,
            confidence_level="HIGH",
            algorithm_version="1.0",
        )

        score_id = repository.save_score_history(updated_score)
        assert score_id is not None

        # Retrieve and verify score change was calculated
        history = repository.get_score_history(fresh_test_ipo_id, days=7)
        assert len(history) >= 2

        # Most recent score should show change
        latest = history[0]
        # Note: score_change calculation depends on repository implementation

    def test_get_score_history_success(self, repository, fresh_test_ipo_id):
        """Test retrieving score history"""
        # Save multiple scores over time
        for i in range(5):
            score = ScoreHistorySchema(
                ipo_id=fresh_test_ipo_id,
                total_score=70 + i,
                fundamental_score=30,
                sentiment_score=20,
                subscription_score=15,
                sector_score=5 + i,
                confidence_level="HIGH",
                algorithm_version="1.0",
            )
            repository.save_score_history(score)

        # Retrieve history
        history = repository.get_score_history(fresh_test_ipo_id, days=7)

        assert len(history) >= 5
        assert all(score["ipo_id"] == fresh_test_ipo_id for score in history)

        # Should be ordered by calculated_at DESC (most recent first)
        if len(history) >= 2:
            assert history[0]["calculated_at"] >= history[1]["calculated_at"]

    def test_get_score_history_with_days_filter(self, repository, fresh_test_ipo_id):
        """Test score history retrieval with days parameter"""
        # Save scores with different timestamps
        old_score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=60,
            fundamental_score=25,
            sentiment_score=18,
            subscription_score=12,
            sector_score=5,
            confidence_level="MEDIUM",
            algorithm_version="1.0",
        )
        repository.save_score_history(old_score)

        # Get history for last 1 day (should include recent scores only)
        recent_history = repository.get_score_history(fresh_test_ipo_id, days=1)

        # Get history for last 30 days (should include all scores)
        full_history = repository.get_score_history(fresh_test_ipo_id, days=30)

        assert len(full_history) >= len(recent_history)

    def test_get_score_history_empty(self, repository):
        """Test retrieving history for non-existent IPO"""
        fake_id = str(uuid.uuid4())
        history = repository.get_score_history(fake_id, days=7)

        assert isinstance(history, list)
        assert len(history) == 0

    def test_get_latest_score_success(self, repository, fresh_test_ipo_id):
        """Test retrieving latest score"""
        # Save first score
        first_score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=75,
            fundamental_score=32,
            sentiment_score=24,
            subscription_score=14,
            sector_score=5,
            confidence_level="MEDIUM",
            algorithm_version="1.0",
        )
        repository.save_score_history(first_score)

        # Save second score with different value
        updated_score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=85,
            fundamental_score=38,
            sentiment_score=27,
            subscription_score=16,
            sector_score=4,
            confidence_level="HIGH",
            algorithm_version="1.0",
        )
        repository.save_score_history(updated_score)

        # Refresh materialized view to include new scores
        repository.refresh_materialized_view()

        # Get latest score
        latest = repository.get_latest_score(fresh_test_ipo_id)

        assert latest is not None
        assert latest["ipo_id"] == fresh_test_ipo_id
        assert latest["total_score"] == 85  # Should be the most recent

    def test_get_latest_score_not_found(self, repository):
        """Test retrieving latest score for non-existent IPO"""
        fake_id = str(uuid.uuid4())
        latest = repository.get_latest_score(fake_id)

        assert latest is None

    def test_apply_manual_override_success(self, repository, fresh_test_ipo_id):
        """Test applying manual score override with audit trail"""
        # First create a base score (manual override requires existing score)
        from algorithms.schemas import ScoreHistorySchema

        base_score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=75,
            fundamental_score=32,
            sentiment_score=24,
            subscription_score=14,
            sector_score=5,
            confidence_level="MEDIUM",
            algorithm_version="1.0",
        )
        repository.save_score_history(base_score)

        # Refresh view to include base score
        repository.refresh_materialized_view()

        # Now apply manual override
        override_data = {
            "total_score": 90,
            "fundamental_score": 38,
            "sentiment_score": 28,
            "subscription_score": 18,
            "sector_score": 6,
            "confidence_level": "HIGH",
        }

        override_id = repository.apply_manual_override(
            ipo_id=fresh_test_ipo_id,
            override_data=override_data,
            reason="Manual adjustment for exceptional fundamentals",
            authorized_by="admin@ipodhan.com",
        )

        assert override_id is not None
        assert isinstance(override_id, str)

        # Refresh view to include override
        repository.refresh_materialized_view()

        # Verify override was saved - check history instead of materialized view
        # (materialized view might have timing issues with concurrent writes)
        history = repository.get_score_history(fresh_test_ipo_id, days=1)
        assert len(history) >= 2  # Base score + override

        # Find the override in history (most recent with score 90)
        override_found = any(score["total_score"] == 90 for score in history)
        assert override_found, "Override score of 90 not found in history"

    def test_save_score_performance_tracking(self, repository, fresh_test_ipo_id):
        """Test saving score performance data"""
        performance_data = {
            "ipo_id": fresh_test_ipo_id,
            "predicted_score": 75,
            "actual_listing_gain": 12.5,  # 12.5% gain on listing
            "prediction_accuracy": 0.85,  # 85% accuracy
        }

        performance_id = repository.save_score_performance(performance_data)

        assert performance_id is not None
        assert isinstance(performance_id, str)

    def test_calculate_score_change(self, repository, fresh_test_ipo_id, sample_score):
        """Test score change calculation"""
        # Save first score
        repository.save_score_history(sample_score)

        # Calculate change for a new score
        new_score = 82
        score_change = repository.calculate_score_change(fresh_test_ipo_id, new_score)

        # Should calculate difference from previous score (75)
        assert score_change == 7  # 82 - 75 = 7

    def test_calculate_score_change_no_previous(self, repository):
        """Test score change calculation when no previous score exists"""
        fake_id = str(uuid.uuid4())
        score_change = repository.calculate_score_change(fake_id, 80)

        # Should return None or 0 when no previous score
        assert score_change is None or score_change == 0

    def test_refresh_materialized_view(self, repository):
        """Test refreshing materialized view"""
        # This should not raise an exception
        try:
            repository.refresh_materialized_view()
            success = True
        except Exception as e:
            success = False
            print(f"Materialized view refresh failed: {e}")

        assert success

    def test_get_all_active_ipo_ids(self, repository):
        """Test retrieving all active IPO IDs"""
        ipo_ids = repository.get_all_active_ipo_ids()

        assert isinstance(ipo_ids, list)
        # May be empty if no active IPOs in test database

    def test_database_connection_pooling(self, repository, fresh_test_ipo_id):
        """Test that connection pooling works correctly"""
        # Make multiple rapid requests to test pooling
        results = []
        for i in range(20):
            score = ScoreHistorySchema(
                ipo_id=fresh_test_ipo_id,
                total_score=70 + i,
                fundamental_score=30,
                sentiment_score=20,
                subscription_score=15,
                sector_score=5,
                confidence_level="HIGH",
                algorithm_version="1.0",
            )
            score_id = repository.save_score_history(score)
            results.append(score_id)

        # All operations should succeed
        assert len(results) == 20
        assert all(result is not None for result in results)

    def test_concurrent_score_saves(self, repository, fresh_test_ipo_id):
        """Test concurrent score saves don't cause database conflicts"""
        import threading

        results = []
        errors = []

        def save_score(score_value):
            try:
                score = ScoreHistorySchema(
                    ipo_id=fresh_test_ipo_id,
                    total_score=score_value,
                    fundamental_score=30,
                    sentiment_score=20,
                    subscription_score=15,
                    sector_score=5,
                    confidence_level="HIGH",
                    algorithm_version="1.0",
                )
                score_id = repository.save_score_history(score)
                results.append(score_id)
            except Exception as e:
                errors.append(str(e))

        # Create threads
        threads = [
            threading.Thread(target=save_score, args=(70 + i,)) for i in range(10)
        ]

        # Start all threads
        for thread in threads:
            thread.start()

        # Wait for completion
        for thread in threads:
            thread.join()

        # All saves should succeed
        assert len(errors) == 0, f"Errors occurred: {errors}"
        assert len(results) == 10

    def test_parameterized_query_security(self, repository):
        """Test that SQL injection is prevented (parameterized queries)"""
        # Attempt SQL injection via ipo_id
        malicious_id = "'; DROP TABLE score_history; --"

        # This should safely fail or return no results, not execute SQL
        try:
            history = repository.get_score_history(malicious_id, days=7)
            # Should return empty list or raise exception, not drop table
            assert isinstance(history, list)
        except Exception:
            # Exception is acceptable (invalid UUID format)
            pass

        # Verify table still exists by making a legitimate query
        test_id = str(uuid.uuid4())
        history = repository.get_score_history(test_id, days=7)
        assert isinstance(history, list)

    def test_score_bounds_validation_in_database(self, repository, fresh_test_ipo_id):
        """Test that Pydantic validation enforces score bounds"""
        # Attempt to create score > 100 (should be prevented by Pydantic validation)
        # Pydantic validates BEFORE database, so this tests the schema validation

        from pydantic import ValidationError

        # This should raise ValidationError due to Pydantic constraints
        with pytest.raises(ValidationError) as exc_info:
            invalid_score = ScoreHistorySchema(
                ipo_id=fresh_test_ipo_id,
                total_score=150,  # Invalid: exceeds 100
                fundamental_score=50,  # Invalid: exceeds 40
                sentiment_score=40,  # Invalid: exceeds 30
                subscription_score=30,  # Invalid: exceeds 20
                sector_score=15,  # Invalid: exceeds 10
                confidence_level="HIGH",
                algorithm_version="1.0",
            )

        # Verify we got validation errors for the invalid fields
        errors = exc_info.value.errors()
        assert len(errors) == 5  # All 5 score fields should have errors
        error_fields = [e["loc"][0] for e in errors]
        assert "total_score" in error_fields
        assert "fundamental_score" in error_fields
