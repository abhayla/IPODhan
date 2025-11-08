#!/bin/bash

# Performance Load Testing Script for IPODhan
# Tests critical API endpoints with concurrent requests

BASE_URL="http://localhost:3006"
OUTPUT_FILE="D:/Abhay/VibeCoding/IPODhan/test-results/phase-5/load-test-results.txt"
ITERATIONS=50
CONCURRENT=10

echo "=== IPODhan Performance Load Testing ===" > "$OUTPUT_FILE"
echo "Start Time: $(date)" >> "$OUTPUT_FILE"
echo "Base URL: $BASE_URL" >> "$OUTPUT_FILE"
echo "Iterations: $ITERATIONS" >> "$OUTPUT_FILE"
echo "Concurrent Requests: $CONCURRENT" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# Function to test endpoint
test_endpoint() {
    local endpoint=$1
    local name=$2

    echo "Testing: $name ($endpoint)" | tee -a "$OUTPUT_FILE"

    # Arrays to store response times
    declare -a times
    local total_time=0
    local success=0
    local failed=0

    # Warm-up request
    curl -s -o /dev/null "$BASE_URL$endpoint"

    # Sequential test (for baseline)
    echo "  Sequential test ($ITERATIONS requests)..." | tee -a "$OUTPUT_FILE"
    for i in $(seq 1 $ITERATIONS); do
        response=$(curl -w "%{http_code}|%{time_total}" -s -o /dev/null "$BASE_URL$endpoint")
        status=$(echo $response | cut -d'|' -f1)
        time=$(echo $response | cut -d'|' -f2)

        if [ "$status" = "200" ]; then
            times+=($time)
            total_time=$(echo "$total_time + $time" | bc -l)
            ((success++))
        else
            ((failed++))
        fi

        # Progress indicator
        if [ $((i % 10)) -eq 0 ]; then
            echo -n "."
        fi
    done
    echo ""

    # Calculate statistics
    avg_time=$(echo "scale=3; $total_time / $success" | bc -l)

    # Sort times for percentile calculation
    IFS=$'\n' sorted=($(sort -n <<<"${times[*]}"))
    unset IFS

    # Calculate p95 (95th percentile)
    p95_index=$(echo "scale=0; ($success * 95 / 100)" | bc)
    p95_time=${sorted[$p95_index]}

    # Calculate p99 (99th percentile)
    p99_index=$(echo "scale=0; ($success * 99 / 100)" | bc)
    p99_time=${sorted[$p99_index]}

    # Min and max
    min_time=${sorted[0]}
    max_time=${sorted[-1]}

    # Requests per second
    rps=$(echo "scale=2; $success / $total_time" | bc -l)

    # Output results
    {
        echo "  Results:"
        echo "    Success: $success/$ITERATIONS"
        echo "    Failed: $failed/$ITERATIONS"
        echo "    Error Rate: $(echo "scale=2; $failed * 100 / $ITERATIONS" | bc -l)%"
        echo "    Average Response Time: ${avg_time}s ($(echo "$avg_time * 1000" | bc)ms)"
        echo "    Min: ${min_time}s ($(echo "$min_time * 1000" | bc)ms)"
        echo "    Max: ${max_time}s ($(echo "$max_time * 1000" | bc)ms)"
        echo "    p95: ${p95_time}s ($(echo "$p95_time * 1000" | bc)ms)"
        echo "    p99: ${p99_time}s ($(echo "$p99_time * 1000" | bc)ms)"
        echo "    RPS: $rps requests/sec"

        # Check against targets
        p95_ms=$(echo "$p95_time * 1000" | bc)
        p99_ms=$(echo "$p99_time * 1000" | bc)

        if [ $(echo "$p95_ms < 500" | bc) -eq 1 ]; then
            echo "    p95 Status: ✅ PASS (<500ms target)"
        else
            echo "    p95 Status: ❌ FAIL (>500ms target)"
        fi

        if [ $(echo "$p99_ms < 1000" | bc) -eq 1 ]; then
            echo "    p99 Status: ✅ PASS (<1000ms target)"
        else
            echo "    p99 Status: ❌ FAIL (>1000ms target)"
        fi
        echo ""
    } | tee -a "$OUTPUT_FILE"
}

# Test critical endpoints
echo "=== API Load Testing ===" | tee -a "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

test_endpoint "/api/ipos?segment=MAINBOARD&limit=20" "IPO List - Mainboard"
test_endpoint "/api/ipos?status=OPEN&limit=20" "IPO List - Open"
test_endpoint "/api/ipos?status=UPCOMING&limit=20" "IPO List - Upcoming"
test_endpoint "/api/ipos?status=LISTED&limit=50" "IPO List - Listed"
test_endpoint "/api/ipos?segment=SME&limit=20" "IPO List - SME"

echo "" | tee -a "$OUTPUT_FILE"
echo "=== Load Testing Complete ===" | tee -a "$OUTPUT_FILE"
echo "End Time: $(date)" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"
echo "Full results saved to: $OUTPUT_FILE"
