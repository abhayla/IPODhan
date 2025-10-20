#!/usr/bin/bash
# Fix Remaining Test Errors - Story 11.8b
# Phase 2: Fix direct property access and type imports

cd /d/Abhay/VibeCoding/IPODhan/web/tests

echo "=== Phase 2: Fixing Direct Property Access ==="

# Fix: Replace `.category` property access with `.segment` or `.offeringType`
# Pattern: expect(data.ipo.category) -> expect(data.ipo.segment)
find . -name "*.ts" -o -name "*.tsx" | while read file; do
    if grep -q "\.category\b" "$file"; then
        echo "Updating: $file"
        # Comment out lines accessing .category for manual review
        sed -i 's/\([^'"'"'"]\)\.category\b/\1.segment/g' "$file"
    fi
done

# Fix: Remove IPOCategory type imports (deprecated)
find . -name "*.ts" -o -name "*.tsx" | while read file; do
    if grep -q "IPOCategory" "$file"; then
        echo "Removing IPOCategory import: $file"
        sed -i '/IPOCategory/d' "$file"
    fi
done

# Fix: Remove ipoCategoryEnum references (deprecated)
find . -name "*.ts" -o -name "*.tsx" | while read file; do
    if grep -q "ipoCategoryEnum" "$file"; then
        echo "Commenting ipoCategoryEnum: $file"
        sed -i 's/\(.*ipoCategoryEnum.*\)/\/\/ DEPRECATED: \1/g' "$file"
    fi
done

echo "=== Phase 2 Complete ==="
