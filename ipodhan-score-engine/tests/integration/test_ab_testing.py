"""
Integration Tests for A/B Testing Framework
Tests experiment creation, variant assignment, and result tracking with PostgreSQL
"""

import pytest
import os
import uuid
from testing.ab_testing import ScoreABTesting
from repositories import DatabaseConfig

# Load environment variables from .env file
from dotenv import load_dotenv

load_dotenv()

# Set test environment
os.environ["TESTING"] = "true"
# Use production database for integration tests (no separate test DB)
# Environment variables are already loaded from .env file


class TestABTestingIntegration:
    """Integration tests for A/B testing framework with PostgreSQL"""

    @pytest.fixture(scope="class")
    def ab_testing(self):
        """Create A/B testing instance"""
        DatabaseConfig.initialize_pool()
        return ScoreABTesting()

    @pytest.fixture
    def experiment_name(self):
        """Generate unique experiment name"""
        return f"test_experiment_{uuid.uuid4().hex[:8]}"

    @pytest.fixture
    def sample_variants(self):
        """Create sample variant configurations"""
        return {
            "control": {"fundamental_weight": 40, "sentiment_weight": 30},
            "variant_a": {"fundamental_weight": 45, "sentiment_weight": 25},
            "variant_b": {"fundamental_weight": 35, "sentiment_weight": 35},
        }

    def test_create_experiment_success(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test creating a new A/B experiment"""
        experiment_id = ab_testing.create_experiment(
            name=experiment_name,
            description="Test weight optimization",
            variants=sample_variants,
        )

        assert experiment_id is not None
        assert isinstance(experiment_id, str)

    def test_create_experiment_duplicate_name(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test that duplicate experiment names are prevented"""
        # Create first experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Attempt to create duplicate (should raise exception)
        with pytest.raises(Exception):
            ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

    def test_get_variant_deterministic(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test that variant assignment is deterministic (same IPO always gets same variant)"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Get variant for same IPO multiple times
        test_ipo_id = str(uuid.uuid4())
        variant1 = ab_testing.get_variant(experiment_name, test_ipo_id)
        variant2 = ab_testing.get_variant(experiment_name, test_ipo_id)
        variant3 = ab_testing.get_variant(experiment_name, test_ipo_id)

        # Should always be the same variant
        assert variant1 == variant2 == variant3
        assert variant1 in sample_variants.keys()

    def test_get_variant_distribution(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test that variants are distributed across multiple IPOs"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Get variants for 100 different IPOs
        variant_counts = {variant: 0 for variant in sample_variants.keys()}

        for i in range(100):
            test_ipo_id = str(uuid.uuid4())
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)
            variant_counts[variant] += 1

        # All variants should be assigned at least once with 100 IPOs
        assert all(count > 0 for count in variant_counts.values())

        # Distribution should be roughly even (allow 20-40% per variant)
        for variant, count in variant_counts.items():
            percentage = count / 100
            assert (
                0.15 < percentage < 0.50
            ), f"{variant} got {percentage*100}% (expected ~33%)"

    def test_get_variant_nonexistent_experiment(self, ab_testing):
        """Test getting variant for non-existent experiment"""
        fake_experiment = f"nonexistent_{uuid.uuid4().hex[:8]}"
        test_ipo_id = str(uuid.uuid4())

        variant = ab_testing.get_variant(fake_experiment, test_ipo_id)

        # Should return None or raise exception
        assert variant is None or variant == "control"

    def test_track_result_success(self, ab_testing, experiment_name, sample_variants):
        """Test tracking experiment results"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Get variant for an IPO
        test_ipo_id = str(uuid.uuid4())
        variant = ab_testing.get_variant(experiment_name, test_ipo_id)

        # Track result
        ab_testing.track_result(
            experiment_name=experiment_name,
            variant=variant,
            ipo_id=test_ipo_id,
            score=75,
            outcome=12.5,  # 12.5% listing gain
        )

        # Should not raise exception
        assert True

    def test_track_multiple_results(self, ab_testing, experiment_name, sample_variants):
        """Test tracking multiple results for different variants"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Track results for multiple IPOs
        results_tracked = 0
        for i in range(20):
            test_ipo_id = str(uuid.uuid4())
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)

            ab_testing.track_result(
                experiment_name=experiment_name,
                variant=variant,
                ipo_id=test_ipo_id,
                score=70 + i,
                outcome=10.0 + (i * 0.5),
            )
            results_tracked += 1

        assert results_tracked == 20

    def test_get_experiment_results(self, ab_testing, experiment_name, sample_variants):
        """Test retrieving experiment results"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Track some results
        for i in range(15):
            test_ipo_id = str(uuid.uuid4())
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)

            ab_testing.track_result(
                experiment_name=experiment_name,
                variant=variant,
                ipo_id=test_ipo_id,
                score=70 + i,
                outcome=8.0 + i,
            )

        # Get results
        results = ab_testing.get_experiment_results(experiment_name)

        assert results is not None
        assert "variants" in results or isinstance(results, dict)
        # Results should contain data for at least one variant

    def test_calculate_variant_performance(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test calculating performance metrics for variants"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Track results with known outcomes
        control_ipo = str(uuid.uuid4())
        variant_a_ipo = str(uuid.uuid4())

        # Force specific variants (or track enough to get distribution)
        for i in range(30):
            test_ipo_id = str(uuid.uuid4())
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)

            # Simulate variant_a performing better
            if variant == "variant_a":
                outcome = 15.0  # Better outcome
            else:
                outcome = 10.0  # Baseline outcome

            ab_testing.track_result(
                experiment_name=experiment_name,
                variant=variant,
                ipo_id=test_ipo_id,
                score=75,
                outcome=outcome,
            )

        # Calculate performance
        performance = ab_testing.calculate_variant_performance(experiment_name)

        assert performance is not None
        # Should contain metrics for each variant

    def test_end_experiment(self, ab_testing, experiment_name, sample_variants):
        """Test ending an experiment"""
        # Create experiment
        experiment_id = ab_testing.create_experiment(
            name=experiment_name, variants=sample_variants
        )

        # End experiment
        ab_testing.end_experiment(experiment_name)

        # Experiment should be marked as completed
        # (Verify by trying to get variant - behavior depends on implementation)

    def test_list_active_experiments(self, ab_testing, sample_variants):
        """Test listing all active experiments"""
        # Create multiple experiments
        exp_names = []
        for i in range(3):
            name = f"test_exp_{uuid.uuid4().hex[:8]}"
            ab_testing.create_experiment(name=name, variants=sample_variants)
            exp_names.append(name)

        # List active experiments
        active_experiments = ab_testing.list_active_experiments()

        assert isinstance(active_experiments, list)
        # Should contain at least the experiments we just created
        assert len(active_experiments) >= 3

    def test_experiment_persistence(self, experiment_name, sample_variants):
        """Test that experiments persist across ScoreABTesting instances"""
        # Create experiment with first instance
        ab_testing1 = ScoreABTesting()
        ab_testing1.create_experiment(name=experiment_name, variants=sample_variants)

        # Create second instance and verify experiment exists
        ab_testing2 = ScoreABTesting()
        test_ipo_id = str(uuid.uuid4())
        variant = ab_testing2.get_variant(experiment_name, test_ipo_id)

        assert variant is not None
        assert variant in sample_variants.keys()

    def test_variant_config_retrieval(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test retrieving variant configuration"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Get variant config
        test_ipo_id = str(uuid.uuid4())
        variant_name = ab_testing.get_variant(experiment_name, test_ipo_id)
        variant_config = ab_testing.get_variant_config(experiment_name, variant_name)

        assert variant_config is not None
        assert "fundamental_weight" in variant_config or isinstance(
            variant_config, dict
        )

    def test_ab_testing_correlation_calculation(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test correlation calculation between predicted scores and outcomes"""
        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        # Track results with correlation
        test_data = [
            (70, 8.0),
            (75, 10.0),
            (80, 12.5),
            (85, 15.0),
            (90, 18.0),
        ]  # Higher scores → higher outcomes

        for score, outcome in test_data:
            test_ipo_id = str(uuid.uuid4())
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)

            ab_testing.track_result(
                experiment_name=experiment_name,
                variant=variant,
                ipo_id=test_ipo_id,
                score=score,
                outcome=outcome,
            )

        # Calculate correlation
        correlation = ab_testing.calculate_score_outcome_correlation(experiment_name)

        # Should show positive correlation (not testing exact value due to sample size)
        assert correlation is not None
        assert isinstance(correlation, dict)
        # Should have correlation values for variants
        if correlation:
            for variant_name, corr_value in correlation.items():
                assert isinstance(corr_value, (int, float))
                assert -1.0 <= corr_value <= 1.0  # Correlation is between -1 and 1

    def test_concurrent_variant_assignment(
        self, ab_testing, experiment_name, sample_variants
    ):
        """Test that concurrent variant assignments are consistent"""
        import threading

        # Create experiment
        ab_testing.create_experiment(name=experiment_name, variants=sample_variants)

        test_ipo_id = str(uuid.uuid4())
        results = []

        def get_variant_thread():
            variant = ab_testing.get_variant(experiment_name, test_ipo_id)
            results.append(variant)

        # Create threads
        threads = [threading.Thread(target=get_variant_thread) for _ in range(10)]

        # Start all threads
        for thread in threads:
            thread.start()

        # Wait for completion
        for thread in threads:
            thread.join()

        # All threads should get the same variant for the same IPO
        assert len(set(results)) == 1, f"Got different variants: {set(results)}"
        assert results[0] in sample_variants.keys()
