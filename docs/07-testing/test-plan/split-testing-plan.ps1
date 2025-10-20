# PowerShell script to split TESTING_PLAN.md into phase-based files
# Run from: docs/07-testing/test-plan/

$sourceFile = "..\..\..\web\TESTING_PLAN.md"
$outputDir = "."

Write-Host "Splitting TESTING_PLAN.md into phase documents..." -ForegroundColor Green

# Read the entire file
$content = Get-Content $sourceFile -Raw

# Define split markers (approximate line numbers from the structure)
# These are the section headers that mark each phase

# Phase 1: Lines after "## PHASE 1" until "## PHASE 2"
# Phase 2: Lines after "## PHASE 2" until "## PHASE 3"
# etc.

# Split by major phase headers
$phases = @{
    "01-PHASE-1-DATA-QUALITY.md" = @{
        Start = "## PHASE 1: DATA SCRAPING & QUALITY VALIDATION"
        End = "## PHASE 2: CORE PAGES TESTING"
    }
    "02-PHASE-2-CORE-PAGES.md" = @{
        Start = "## PHASE 2: CORE PAGES TESTING"
        End = "## PHASE 3: TOOLS & FEATURES TESTING"
    }
    "03-PHASE-3-TOOLS-FEATURES.md" = @{
        Start = "## PHASE 3: TOOLS & FEATURES TESTING"
        End = "## PHASE 4: CATEGORY PAGES TESTING"
    }
    "04-PHASE-4-CATEGORY-PAGES.md" = @{
        Start = "## PHASE 4: CATEGORY PAGES TESTING"
        End = "## PHASE 5: INTEGRATION & PERFORMANCE TESTING"
    }
    "05-PHASE-5-INTEGRATION.md" = @{
        Start = "## PHASE 5: INTEGRATION & PERFORMANCE TESTING"
        End = "---END OF DOCUMENT---"  # For the last phase
    }
}

foreach ($fileName in $phases.Keys) {
    $phase = $phases[$fileName]

    # Find start and end positions
    $startPos = $content.IndexOf($phase.Start)
    $endPos = $content.IndexOf($phase.End)

    if ($startPos -ge 0 -and $endPos -gt $startPos) {
        $phaseContent = $content.Substring($startPos, $endPos - $startPos)

        # Add header with navigation
        $header = @"
# $($fileName -replace '\.md$','' -replace '\d\d-','')

**[← Back to Index](README.md)** | **[Overview](00-TESTING-OVERVIEW.md)**

---

"@

        $fullContent = $header + $phaseContent

        # Write to file
        $outputPath = Join-Path $outputDir $fileName
        $fullContent | Out-File -FilePath $outputPath -Encoding UTF8

        Write-Host "✓ Created $fileName" -ForegroundColor Cyan
    } else {
        Write-Host "✗ Could not find markers for $fileName" -ForegroundColor Red
    }
}

Write-Host "`nSplit complete! Files created in: $outputDir" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Review each phase file for proper formatting"
Write-Host "2. Create APPENDIX files manually (APPENDIX-A, B, C)"
Write-Host "3. Verify cross-references work correctly"
