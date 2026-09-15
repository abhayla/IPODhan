// Compatibility path for the pr-gate.yml step "Ratios extraction-yield check
// self-test (lane B item 8)", which names this file explicitly. The check it
// guarded (ratios_extraction_yield) was retired on 2026-09-16 (#677): its
// population, RATIOS_BASIS_ISSUE_PRICE, has no extractor by design, so the
// module became the NOT_APPLICABLE reporter and its tests live in
// not-applicable-documents.test.mjs. Importing that file registers its tests
// here, so the CI step keeps running the real suite until the workflow line
// is renamed in a workflow-file window (never edited in a code PR). Delete
// this file in the same PR that renames the step.
import './not-applicable-documents.test.mjs';
