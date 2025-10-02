"""
A/B Testing Framework for Scoring Algorithms
Allows testing different algorithm variants to optimize performance
"""

import logging
import hashlib
import json
from datetime import datetime
from typing import Dict, List, Optional
from repositories.db_config import DatabaseConfig

logger = logging.getLogger(__name__)


class ScoreABTesting:
    """
    A/B testing framework for algorithm variants
    Uses deterministic variant assignment based on IPO ID hash
    """

    def __init__(self):
        """Initialize A/B testing framework"""
        logger.info("ScoreABTesting initialized")

    def create_experiment(self, name: str, variants, description: str = None) -> str:
        """
        Create a new A/B test experiment
        Args:
            name: Experiment name (unique)
            variants: Dict or List of variant configurations
                Dict format: {'control': {...config...}, 'variant_a': {...config...}}
                List format: [
                    {'name': 'control', 'weight': 50, 'config': {...}},
                    {'name': 'variant_a', 'weight': 50, 'config': {...}}
                ]
            description: Optional experiment description
        Returns: Experiment ID
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Normalize variants to list format with equal weights
                if isinstance(variants, dict):
                    # Convert dict to list with equal distribution
                    equal_weight = 100 // len(variants)
                    remainder = 100 % len(variants)

                    variants_list = []
                    for idx, (variant_name, config) in enumerate(variants.items()):
                        weight = equal_weight + (1 if idx < remainder else 0)
                        variants_list.append(
                            {"name": variant_name, "weight": weight, "config": config}
                        )
                    variants = variants_list

                # Validate variants
                total_weight = sum(v.get("weight", 0) for v in variants)
                if total_weight != 100:
                    raise ValueError(
                        f"Variant weights must sum to 100, got {total_weight}"
                    )

                insert_query = """
                    INSERT INTO ab_experiments (
                        name, description, variants, status
                    ) VALUES (%s, %s, %s, %s)
                    RETURNING id
                """

                cursor.execute(
                    insert_query, (name, description, json.dumps(variants), "ACTIVE")
                )

                experiment_id = cursor.fetchone()[0]
                conn.commit()

                logger.info(
                    f"A/B experiment created: {name} (ID: {experiment_id}) "
                    f"with {len(variants)} variants"
                )

                return str(experiment_id)

        except Exception as e:
            logger.error(f"Failed to create experiment: {e}")
            raise

    def get_variant(self, experiment_name: str, ipo_id: str) -> Optional[str]:
        """
        Deterministically assign an IPO to a variant
        Uses MD5 hash of (experiment_name + ipo_id) for consistent assignment
        Args:
            experiment_name: Name of the experiment
            ipo_id: IPO UUID
        Returns: Variant name (str) or None if experiment not found/inactive
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Get experiment
                query = """
                    SELECT id, variants, status
                    FROM ab_experiments
                    WHERE name = %s
                """

                cursor.execute(query, (experiment_name,))
                row = cursor.fetchone()

                if not row:
                    logger.warning(f"Experiment not found: {experiment_name}")
                    return None

                experiment_id, variants_json, status = row

                if status != "ACTIVE":
                    logger.info(
                        f"Experiment {experiment_name} is not active (status: {status})"
                    )
                    return None

                # PostgreSQL JSONB returns already parsed data
                variants = (
                    variants_json
                    if isinstance(variants_json, list)
                    else json.loads(variants_json)
                )

                # Deterministic assignment using hash
                hash_input = f"{experiment_name}:{ipo_id}".encode("utf-8")
                hash_value = int(hashlib.md5(hash_input).hexdigest(), 16)
                assignment_value = hash_value % 100  # 0-99

                # Assign to variant based on weights
                cumulative_weight = 0
                for variant in variants:
                    cumulative_weight += variant["weight"]
                    if assignment_value < cumulative_weight:
                        variant_name = variant["name"]
                        logger.debug(
                            f"IPO {ipo_id} assigned to variant '{variant_name}' "
                            f"in experiment '{experiment_name}'"
                        )
                        return variant_name

                # Fallback to last variant (should not happen if weights sum to 100)
                logger.warning(f"Fallback to last variant for IPO {ipo_id}")
                return variants[-1]["name"]

        except Exception as e:
            logger.error(f"Failed to get variant: {e}")
            return None

    def track_result(
        self,
        experiment_name: str,
        variant: str,
        ipo_id: str,
        score: int,
        outcome: Optional[float] = None,
    ) -> bool:
        """
        Track experiment result
        Args:
            experiment_name: Name of the experiment
            variant: Name of the variant (accepts 'variant' for backward compatibility)
            ipo_id: IPO UUID
            score: Predicted score
            outcome: Actual outcome (e.g., listing gain %) - optional
        Returns: True if tracked successfully
        """
        variant_name = variant  # Rename for internal use
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                # Get experiment
                query = """
                    SELECT id, results
                    FROM ab_experiments
                    WHERE name = %s
                """

                cursor.execute(query, (experiment_name,))
                row = cursor.fetchone()

                if not row:
                    logger.warning(f"Experiment not found: {experiment_name}")
                    return False

                experiment_id, results_json = row
                # PostgreSQL JSONB returns already parsed data
                results = (
                    results_json
                    if isinstance(results_json, dict)
                    else (json.loads(results_json) if results_json else {})
                )

                # Initialize variant results if not exists
                if variant_name not in results:
                    results[variant_name] = {
                        "count": 0,
                        "total_score": 0,
                        "scores": [],
                        "outcomes": [],
                    }

                # Update results
                results[variant_name]["count"] += 1
                results[variant_name]["total_score"] += score
                results[variant_name]["scores"].append(score)

                if outcome is not None:
                    results[variant_name]["outcomes"].append(outcome)

                # Update experiment
                update_query = """
                    UPDATE ab_experiments
                    SET results = %s, updated_at = %s
                    WHERE id = %s
                """

                cursor.execute(
                    update_query,
                    (json.dumps(results), datetime.utcnow(), experiment_id),
                )

                conn.commit()

                logger.info(
                    f"Result tracked for experiment '{experiment_name}', "
                    f"variant '{variant_name}': score={score}, outcome={outcome}"
                )

                return True

        except Exception as e:
            logger.error(f"Failed to track result: {e}")
            return False

    def get_experiment_results(self, experiment_name: str) -> Optional[Dict]:
        """
        Get aggregated results for an experiment
        Returns: Results dict with statistics per variant
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                query = """
                    SELECT
                        id, name, description, variants, status,
                        start_date, end_date, results
                    FROM ab_experiments
                    WHERE name = %s
                """

                cursor.execute(query, (experiment_name,))
                row = cursor.fetchone()

                if not row:
                    logger.warning(f"Experiment not found: {experiment_name}")
                    return None

                # PostgreSQL JSONB returns already parsed data
                variants_data = (
                    row[3] if isinstance(row[3], list) else json.loads(row[3])
                )
                results_data = (
                    row[7]
                    if isinstance(row[7], dict)
                    else (json.loads(row[7]) if row[7] else {})
                )

                experiment = {
                    "id": str(row[0]),
                    "name": row[1],
                    "description": row[2],
                    "variants": variants_data,
                    "status": row[4],
                    "start_date": row[5].isoformat() if row[5] else None,
                    "end_date": row[6].isoformat() if row[6] else None,
                    "results": results_data,
                }

                # Calculate statistics
                for variant_name, variant_results in experiment["results"].items():
                    count = variant_results["count"]
                    if count > 0:
                        variant_results["avg_score"] = (
                            variant_results["total_score"] / count
                        )

                        if variant_results["outcomes"]:
                            variant_results["avg_outcome"] = sum(
                                variant_results["outcomes"]
                            ) / len(variant_results["outcomes"])
                            variant_results["correlation"] = (
                                self._calculate_correlation(
                                    variant_results["scores"],
                                    variant_results["outcomes"],
                                )
                            )

                logger.info(f"Retrieved results for experiment '{experiment_name}'")
                return experiment

        except Exception as e:
            logger.error(f"Failed to get experiment results: {e}")
            return None

    def end_experiment(self, experiment_name: str) -> bool:
        """
        End an experiment (mark as COMPLETED)
        Returns: True if successful
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                update_query = """
                    UPDATE ab_experiments
                    SET status = 'COMPLETED', end_date = %s, updated_at = %s
                    WHERE name = %s AND status = 'ACTIVE'
                """

                cursor.execute(
                    update_query,
                    (datetime.utcnow(), datetime.utcnow(), experiment_name),
                )

                conn.commit()

                if cursor.rowcount > 0:
                    logger.info(f"Experiment '{experiment_name}' marked as COMPLETED")
                    return True
                else:
                    logger.warning(
                        f"Experiment '{experiment_name}' not found or already completed"
                    )
                    return False

        except Exception as e:
            logger.error(f"Failed to end experiment: {e}")
            return False

    def calculate_variant_performance(self, experiment_name: str) -> Optional[Dict]:
        """
        Calculate performance metrics for all variants in an experiment
        Returns: Dict with performance metrics per variant
        """
        try:
            results = self.get_experiment_results(experiment_name)
            if not results or "results" not in results:
                return None

            performance = {}
            for variant_name, variant_data in results["results"].items():
                if variant_data["count"] > 0:
                    performance[variant_name] = {
                        "count": variant_data["count"],
                        "avg_score": variant_data.get("avg_score", 0),
                        "avg_outcome": variant_data.get("avg_outcome", 0),
                        "correlation": variant_data.get("correlation", 0),
                    }

            return performance

        except Exception as e:
            logger.error(f"Failed to calculate variant performance: {e}")
            return None

    def list_active_experiments(self) -> List[Dict]:
        """
        List all active experiments
        Returns: List of active experiments with basic info
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                query = """
                    SELECT id, name, description, created_at
                    FROM ab_experiments
                    WHERE status = 'ACTIVE'
                    ORDER BY created_at DESC
                """

                cursor.execute(query)
                rows = cursor.fetchall()

                experiments = []
                for row in rows:
                    experiments.append(
                        {
                            "id": str(row[0]),
                            "name": row[1],
                            "description": row[2],
                            "created_at": row[3].isoformat() if row[3] else None,
                        }
                    )

                logger.info(f"Found {len(experiments)} active experiments")
                return experiments

        except Exception as e:
            logger.error(f"Failed to list active experiments: {e}")
            return []

    def get_variant_config(
        self, experiment_name: str, variant_name: str
    ) -> Optional[Dict]:
        """
        Get configuration for a specific variant
        Args:
            experiment_name: Name of the experiment
            variant_name: Name of the variant
        Returns: Variant configuration dict or None
        """
        try:
            with DatabaseConfig.get_connection() as conn:
                cursor = conn.cursor()

                query = """
                    SELECT variants
                    FROM ab_experiments
                    WHERE name = %s
                """

                cursor.execute(query, (experiment_name,))
                row = cursor.fetchone()

                if not row:
                    logger.warning(f"Experiment not found: {experiment_name}")
                    return None

                # PostgreSQL JSONB returns already parsed data
                variants = row[0] if isinstance(row[0], list) else json.loads(row[0])

                # Find the variant
                for variant in variants:
                    if variant["name"] == variant_name:
                        return variant.get("config", {})

                logger.warning(
                    f"Variant '{variant_name}' not found in experiment '{experiment_name}'"
                )
                return None

        except Exception as e:
            logger.error(f"Failed to get variant config: {e}")
            return None

    def calculate_score_outcome_correlation(
        self, experiment_name: str
    ) -> Optional[Dict]:
        """
        Calculate correlation between scores and outcomes for each variant
        Returns: Dict with correlation coefficients per variant
        """
        try:
            results = self.get_experiment_results(experiment_name)
            if not results or "results" not in results:
                return None

            correlations = {}
            for variant_name, variant_data in results["results"].items():
                if "correlation" in variant_data:
                    correlations[variant_name] = variant_data["correlation"]
                else:
                    correlations[variant_name] = 0.0

            return correlations

        except Exception as e:
            logger.error(f"Failed to calculate correlation: {e}")
            return None

    def _calculate_correlation(self, scores: List[int], outcomes: List[float]) -> float:
        """
        Calculate Pearson correlation between scores and outcomes
        Simple implementation for A/B testing
        """
        if len(scores) != len(outcomes) or len(scores) < 2:
            return 0.0

        n = len(scores)
        mean_scores = sum(scores) / n
        mean_outcomes = sum(outcomes) / n

        numerator = sum(
            (scores[i] - mean_scores) * (outcomes[i] - mean_outcomes) for i in range(n)
        )
        denominator_scores = sum((s - mean_scores) ** 2 for s in scores) ** 0.5
        denominator_outcomes = sum((o - mean_outcomes) ** 2 for o in outcomes) ** 0.5

        if denominator_scores == 0 or denominator_outcomes == 0:
            return 0.0

        correlation = numerator / (denominator_scores * denominator_outcomes)
        return round(correlation, 3)
