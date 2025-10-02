"""
FastAPI Score Service
REST API endpoints for IPO scoring engine
"""

import logging
import os
import redis
import json
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="IPODhan Score Engine API",
    description="REST API for IPO scoring and analytics",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update with specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Redis client for caching
redis_client = redis.Redis(
    host=os.getenv("REDIS_HOST", "localhost"),
    port=int(os.getenv("REDIS_PORT", 6379)),
    password=os.getenv("REDIS_PASSWORD", None) if os.getenv("REDIS_PASSWORD") else None,
    db=int(os.getenv("REDIS_DB", 0)),
    decode_responses=True,
)

# Test Redis connection
try:
    redis_client.ping()
    logger.info("Redis connection successful")
except redis.ConnectionError:
    logger.warning("Redis connection failed - caching disabled")
    redis_client = None

# Import repositories and engines
from repositories import ScoreRepository, DatabaseConfig
from algorithms import IPOScoringEngine
from algorithms.sme_adjuster import SMEAdjuster

# Initialize components
DatabaseConfig.initialize_pool()
score_repository = ScoreRepository()
scoring_engine = IPOScoringEngine()
sme_adjuster = SMEAdjuster()


# Dependency for API key authentication (for protected endpoints)
async def verify_api_key(x_api_key: str = Header(None)):
    """Verify API key for protected endpoints"""
    expected_key = os.getenv("API_KEY")
    if not expected_key:
        logger.warning("API_KEY not configured - authentication disabled")
        return True

    if x_api_key != expected_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "IPODhan Score Engine",
        "version": "1.0.0",
        "status": "running",
        "redis": "connected" if redis_client else "disconnected",
    }


@app.get("/api/scores/accuracy")
async def get_accuracy_metrics():
    """
    Get accuracy metrics dashboard
    Shows overall prediction accuracy correlation
    """
    try:
        # TODO: Implement accuracy calculation from score_performance table
        # Placeholder response
        return {
            "overall_accuracy": 0.0,
            "total_predictions": 0,
            "message": "Accuracy tracking not yet implemented",
        }

    except Exception as e:
        logger.error(f"Error getting accuracy metrics: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/scores/{ipo_id}")
async def get_score(ipo_id: str):
    """
    Get current IPO score with breakdown
    Caches result in Redis for 1 hour
    """
    try:
        # Check Redis cache first
        cache_key = f"score:{ipo_id}:latest"
        if redis_client:
            cached = redis_client.get(cache_key)
            if cached:
                logger.info(f"Cache hit for IPO {ipo_id}")
                return json.loads(cached)

        # Get from database
        score = score_repository.get_latest_score(ipo_id)

        if not score:
            raise HTTPException(
                status_code=404, detail=f"No score found for IPO {ipo_id}"
            )

        # Cache the result
        if redis_client:
            cache_ttl = int(os.getenv("SCORE_CACHE_TTL", 3600))
            redis_client.setex(cache_key, cache_ttl, json.dumps(score))

        logger.info(f"Retrieved score for IPO {ipo_id}: {score['total_score']}")
        return score

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting score for IPO {ipo_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/scores/{ipo_id}/history")
async def get_score_history(ipo_id: str, days: int = 7):
    """
    Get historical scores for an IPO
    Args:
        ipo_id: IPO UUID
        days: Number of days to retrieve (default 7, max 90)
    """
    try:
        # Validate days parameter
        if days < 1 or days > 90:
            raise HTTPException(
                status_code=400, detail="Days parameter must be between 1 and 90"
            )

        # Check cache
        cache_key = f"score:{ipo_id}:history:{days}"
        if redis_client:
            cached = redis_client.get(cache_key)
            if cached:
                logger.info(f"Cache hit for IPO {ipo_id} history ({days} days)")
                return json.loads(cached)

        # Get from database
        history = score_repository.get_score_history(ipo_id, days)

        if not history:
            raise HTTPException(
                status_code=404, detail=f"No score history found for IPO {ipo_id}"
            )

        # Cache the result
        if redis_client:
            cache_ttl = int(os.getenv("SCORE_CACHE_TTL", 3600))
            redis_client.setex(cache_key, cache_ttl, json.dumps(history))

        logger.info(f"Retrieved {len(history)} historical scores for IPO {ipo_id}")
        return {"ipo_id": ipo_id, "days": days, "history": history}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting score history for IPO {ipo_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/scores/{ipo_id}/breakdown")
async def get_score_breakdown(ipo_id: str):
    """
    Get detailed component breakdown for an IPO score
    Returns latest score with component details
    """
    try:
        # Check cache
        cache_key = f"score:{ipo_id}:breakdown"
        if redis_client:
            cached = redis_client.get(cache_key)
            if cached:
                logger.info(f"Cache hit for IPO {ipo_id} breakdown")
                return json.loads(cached)

        # Get latest score
        score = score_repository.get_latest_score(ipo_id)

        if not score:
            raise HTTPException(
                status_code=404, detail=f"No score found for IPO {ipo_id}"
            )

        # Build detailed breakdown
        breakdown = {
            "ipo_id": ipo_id,
            "company_name": score["company_name"],
            "total_score": score["total_score"],
            "verdict": score["verdict"],
            "verdict_color": score["verdict_color"],
            "confidence": score["confidence_level"],
            "components": {
                "fundamentals": {
                    "score": score["fundamental_score"],
                    "max": 40,
                    "percentage": round((score["fundamental_score"] / 40) * 100, 1),
                },
                "sentiment": {
                    "score": score["sentiment_score"],
                    "max": 30,
                    "percentage": round((score["sentiment_score"] / 30) * 100, 1),
                },
                "subscription": {
                    "score": score["subscription_score"],
                    "max": 20,
                    "percentage": round((score["subscription_score"] / 20) * 100, 1),
                },
                "sector": {
                    "score": score["sector_score"],
                    "max": 10,
                    "percentage": round((score["sector_score"] / 10) * 100, 1),
                },
            },
            "algorithm_version": score["algorithm_version"],
            "calculated_at": score["calculated_at"],
        }

        # Cache the result
        if redis_client:
            cache_ttl = int(os.getenv("SCORE_CACHE_TTL", 3600))
            redis_client.setex(cache_key, cache_ttl, json.dumps(breakdown))

        logger.info(f"Retrieved score breakdown for IPO {ipo_id}")
        return breakdown

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting score breakdown for IPO {ipo_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@app.post("/api/scores/{ipo_id}/recalculate")
async def recalculate_score(ipo_id: str, authorized: bool = Depends(verify_api_key)):
    """
    Trigger score recalculation for an IPO
    Protected endpoint - requires API key
    """
    try:
        # TODO: Fetch IPO data from database
        # TODO: Calculate score using scoring engine
        # TODO: Save to score_history
        # TODO: Invalidate cache

        # Placeholder response
        logger.info(f"Score recalculation triggered for IPO {ipo_id}")

        # Invalidate all caches for this IPO
        if redis_client:
            keys_to_delete = [f"score:{ipo_id}:latest", f"score:{ipo_id}:breakdown"]
            # Also delete history caches (days 1-90)
            for days in [7, 30, 90]:
                keys_to_delete.append(f"score:{ipo_id}:history:{days}")

            for key in keys_to_delete:
                redis_client.delete(key)

            logger.info(f"Cache invalidated for IPO {ipo_id}")

        return {
            "ipo_id": ipo_id,
            "status": "recalculation_triggered",
            "message": "Score recalculation in progress",
            "timestamp": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"Error recalculating score for IPO {ipo_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


# Error handlers
@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    """Standard HTTP exception handler"""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    """General exception handler"""
    logger.error(f"Unhandled exception: {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    DatabaseConfig.close_pool()
    if redis_client:
        redis_client.close()
    logger.info("Application shutdown complete")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("API_HOST", "0.0.0.0"),
        port=int(os.getenv("API_PORT", 8001)),
        reload=True,
    )
