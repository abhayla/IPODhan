"""RETIRED 2026-09-20. Use: node scripts/ops/render-board.mjs

This script spliced new content into a saved copy of the LIVE page and asserted
on that page's structure. That makes the renderer depend on its own previous
output: the 2026-09-20 restructure replaced both anchors it asserted on, so the
next run would have failed with a stack trace rather than a message.

render-board.mjs renders the WHOLE page from data files instead. It never reads
the published artifact, so restructuring the page cannot break the pipeline.

    node scripts/ops/build-plan-board.mjs   # only if a spec source changed
    node scripts/ops/render-board.mjs       # writes docs/design/board/index.html
    # then publish index.html with url = the board URL

See docs/design/board/README.md.
"""
import sys

sys.exit(
    "patch-plan.py is retired.\n"
    "Run:  node scripts/ops/render-board.mjs\n"
    "Then publish docs/design/board/index.html with the board URL.\n"
    "Why: it patched the live page and asserted on the page's own structure.\n"
)
