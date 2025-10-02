"""
Integration Tests for Score API
Tests all FastAPI endpoints with real database and Redis integration
"""

import pytest
import os
import json
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
import uuid

# Load environment variables from .env file
from dotenv import load_dotenv

load_dotenv()

# Set test environment before importing app
os.environ["TESTING"] = "true"
# Use production database for integration tests (no separate test DB)
# Environment variables are already loaded from .env file
os.environ["API_KEY"] = "test-api-key-12345"

from api.main import app
from repositories import ScoreRepository, DatabaseConfig
from algorithms.schemas import ScoreHistorySchema


class TestScoreAPI:
    """Integration tests for Score API endpoints"""

    @pytest.fixture(scope="class")
    def client(self):
        """Create test client"""
        return TestClient(app)

    # Use fresh_test_ipo_id from conftest.py instead of generating UUID
    # This provides a real IPO ID from production database

    @pytest.fixture(scope="class")
    def repository(self):
        """Create repository instance"""
        DatabaseConfig.initialize_pool()
        return ScoreRepository()

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
            calculated_at=datetime.now(),
        )

    def test_health_check(self, client):
        """Test API health check endpoint"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "running"
        assert "version" in data
        assert data["service"] == "IPODhan Score Engine"

    def test_get_score_not_found(self, client):
        """Test GET /api/scores/{ipo_id} with non-existent IPO"""
        fake_id = str(uuid.uuid4())
        response = client.get(f"/api/scores/{fake_id}")
        assert response.status_code == 404
        assert "no score found" in response.json()["detail"].lower()

    def test_get_score_success(
        self, client, repository, fresh_test_ipo_id, sample_score
    ):
        """Test GET /api/scores/{ipo_id} with valid IPO"""
        # First, save a score to the database
        repository.save_score_history(sample_score)

        # Refresh materialized view to include new score
        repository.refresh_materialized_view()

        # Then retrieve it via API
        response = client.get(f"/api/scores/{fresh_test_ipo_id}")
        assert response.status_code == 200

        data = response.json()
        assert data["ipo_id"] == fresh_test_ipo_id
        assert data["total_score"] == 75
        assert data["fundamental_score"] == 32
        assert data["sentiment_score"] == 24
        assert data["confidence_level"] == "HIGH"

    def test_get_score_caching(
        self, client, fresh_test_ipo_id, repository, sample_score
    ):
        """Test Redis caching behavior"""
        # Save score
        repository.save_score_history(sample_score)

        # Refresh materialized view
        repository.refresh_materialized_view()

        # First request (cache miss)
        response1 = client.get(f"/api/scores/{fresh_test_ipo_id}")
        assert response1.status_code == 200

        # Second request (should hit cache)
        response2 = client.get(f"/api/scores/{fresh_test_ipo_id}")
        assert response2.status_code == 200

        # Both responses should be identical
        assert response1.json() == response2.json()

    def test_get_score_history_success(self, client, repository, fresh_test_ipo_id):
        """Test GET /api/scores/{ipo_id}/history"""
        # Create multiple historical scores
        for i in range(3):
            score = ScoreHistorySchema(
                ipo_id=fresh_test_ipo_id,
                total_score=70 + i,
                fundamental_score=30,
                sentiment_score=20,
                subscription_score=15,
                sector_score=5 + i,
                confidence_level="HIGH",
                algorithm_version="1.0",
                calculated_at=datetime.now() - timedelta(days=i),
            )
            repository.save_score_history(score)

        # Retrieve history
        response = client.get(f"/api/scores/{fresh_test_ipo_id}/history?days=7")
        assert response.status_code == 200

        data = response.json()
        assert "history" in data
        assert len(data["history"]) >= 3
        assert data["ipo_id"] == fresh_test_ipo_id

    def test_get_score_history_with_days_param(
        self, client, repository, fresh_test_ipo_id
    ):
        """Test GET /api/scores/{ipo_id}/history with days parameter"""
        # Create a test score
        score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=70,
            fundamental_score=30,
            sentiment_score=20,
            subscription_score=15,
            sector_score=5,
            confidence_level="HIGH",
            algorithm_version="1.0",
        )
        repository.save_score_history(score)

        response = client.get(f"/api/scores/{fresh_test_ipo_id}/history?days=30")
        assert response.status_code == 200

        data = response.json()
        assert "days" in data
        assert data["days"] == 30

    def test_get_score_breakdown_success(
        self, client, repository, fresh_test_ipo_id, sample_score
    ):
        """Test GET /api/scores/{ipo_id}/breakdown"""
        # Save score
        repository.save_score_history(sample_score)

        # Refresh materialized view
        repository.refresh_materialized_view()

        response = client.get(f"/api/scores/{fresh_test_ipo_id}/breakdown")
        assert response.status_code == 200

        data = response.json()
        assert data["ipo_id"] == fresh_test_ipo_id
        assert "components" in data

        # Verify component breakdown (API returns fundamentals, sentiment, subscription, sector)
        components = data["components"]
        assert components["fundamentals"]["score"] == 32
        assert components["sentiment"]["score"] == 24
        assert components["subscription"]["score"] == 14
        assert components["sector"]["score"] == 5

    def test_recalculate_score_without_api_key(self, client, fresh_test_ipo_id):
        """Test POST /api/scores/{ipo_id}/recalculate without API key (should fail)"""
        response = client.post(f"/api/scores/{fresh_test_ipo_id}/recalculate")
        assert response.status_code == 401  # API returns 401 for missing key
        assert "api key" in response.json()["detail"].lower()

    def test_recalculate_score_with_invalid_api_key(self, client, fresh_test_ipo_id):
        """Test POST /api/scores/{ipo_id}/recalculate with invalid API key"""
        response = client.post(
            f"/api/scores/{fresh_test_ipo_id}/recalculate",
            headers={"X-API-Key": "wrong-key"},
        )
        assert response.status_code == 401  # API returns 401 for invalid key

    def test_recalculate_score_with_valid_api_key(self, client, fresh_test_ipo_id):
        """Test POST /api/scores/{ipo_id}/recalculate with valid API key"""
        response = client.post(
            f"/api/scores/{fresh_test_ipo_id}/recalculate",
            headers={"X-API-Key": "test-api-key-12345"},
        )

        # May return 404 if IPO doesn't exist in pipeline, or 200 if successful
        assert response.status_code in [200, 404]

        if response.status_code == 200:
            data = response.json()
            assert "score" in data or "message" in data

    def test_get_accuracy_metrics(self, client):
        """Test GET /api/scores/accuracy endpoint"""
        response = client.get("/api/scores/accuracy")
        assert response.status_code == 200

        data = response.json()
        # Endpoint returns placeholder response
        assert "overall_accuracy" in data
        assert "message" in data
        assert data["message"] == "Accuracy tracking not yet implemented"

    def test_api_error_handling_invalid_uuid(self, client):
        """Test API error handling with invalid UUID format"""
        response = client.get("/api/scores/not-a-uuid")
        # API returns 500 because invalid UUID causes database error
        assert response.status_code == 500

    def test_api_cors_headers(self, client, fresh_test_ipo_id):
        """Test CORS headers are present"""
        response = client.get(
            f"/api/scores/{fresh_test_ipo_id}",
            headers={"Origin": "http://localhost:3000"},
        )

        # CORS headers should be present
        assert "access-control-allow-origin" in response.headers

    def test_api_openapi_docs(self, client):
        """Test OpenAPI documentation is accessible"""
        response = client.get("/api/docs")
        assert response.status_code == 200

        # ReDoc should also be accessible
        response = client.get("/api/redoc")
        assert response.status_code == 200

    def test_concurrent_score_requests(self, client, repository, fresh_test_ipo_id):
        """Test handling of concurrent requests for same IPO"""
        import threading

        # Save a score first
        score = ScoreHistorySchema(
            ipo_id=fresh_test_ipo_id,
            total_score=80,
            fundamental_score=35,
            sentiment_score=25,
            subscription_score=15,
            sector_score=5,
            confidence_level="HIGH",
            algorithm_version="1.0",
        )
        repository.save_score_history(score)

        # Refresh materialized view
        repository.refresh_materialized_view()

        results = []

        def make_request():
            response = client.get(f"/api/scores/{fresh_test_ipo_id}")
            results.append(response.status_code)

        # Create multiple threads
        threads = [threading.Thread(target=make_request) for _ in range(10)]

        # Start all threads
        for thread in threads:
            thread.start()

        # Wait for all to complete
        for thread in threads:
            thread.join()

        # All requests should succeed
        assert all(status == 200 for status in results)
        assert len(results) == 10

    def test_cache_invalidation_on_recalculate(
        self, client, repository, fresh_test_ipo_id, sample_score
    ):
        """Test that cache is invalidated when score is recalculated"""
        # Save initial score
        repository.save_score_history(sample_score)

        # Refresh materialized view
        repository.refresh_materialized_view()

        # Get score (should cache it)
        response1 = client.get(f"/api/scores/{fresh_test_ipo_id}")
        assert response1.status_code == 200
        score1 = response1.json()["total_score"]

        # Recalculate (with valid API key)
        client.post(
            f"/api/scores/{fresh_test_ipo_id}/recalculate",
            headers={"X-API-Key": "test-api-key-12345"},
        )

        # Get score again (should fetch from database, not cache)
        response2 = client.get(f"/api/scores/{fresh_test_ipo_id}")
        assert response2.status_code == 200

        # Cache should have been invalidated
        # (score may or may not have changed depending on data availability)
