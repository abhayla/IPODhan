# Defect Report: [TITLE]

**ID**: DEF-2025-XXX
**Date**: YYYY-MM-DD
**Reporter**: [Name]
**Status**: NEW | ASSIGNED | OPEN | FIXED | VERIFIED | CLOSED

## Classification

- **Severity**: P0 (Critical) | P1 (Major) | P2 (Minor) | P3 (Trivial)
- **Priority**: Immediate | High | Medium | Low
- **Component**: Homepage | Dashboard | IPO Detail | API | Build | Other
- **Type**: Functional | UI | Performance | Security | Build | Data

## Environment

- **Browser**: Chrome 120 | Firefox 115 | Safari 17 | Edge 119
- **OS**: Windows 11 | macOS 14 | Linux (Ubuntu 22.04)
- **Device**: Desktop | Mobile | Tablet
- **Viewport**: 1920x1080 | 375x667 | 768x1024 | Other
- **URL**: `http://localhost:3000/[path]`
- **Data State**: Fresh DB | Seeded | Production Snapshot

## Description

[Clear, detailed description of the issue. Include what you were trying to do and what went wrong.]

## Steps to Reproduce

1. [First step]
2. [Second step]
3. [Third step]
4. [Observation step]

## Expected Result

[What should happen - the correct behavior]

## Actual Result

[What actually happens - the buggy behavior]

## Evidence

- [ ] **Screenshot**: [filename.png]
- [ ] **Console Error**:
  ```
  [Paste exact error message here]
  ```
- [ ] **Network Log**: [if relevant]
- [ ] **Video Recording**: [if complex interaction]
- [ ] **Code Snippet**: [if code-related]

## Impact Analysis

- **Users Affected**: All (100%) | Most (>50%) | Some (10-50%) | Few (<10%)
- **Business Impact**: High | Medium | Low
- **Frequency**: Always (100%) | Often (>50%) | Sometimes (10-50%) | Rarely (<10%)
- **Workaround Available**: Yes | No
  - **Workaround Description**: [if yes, describe the workaround]

## Root Cause

[To be filled after investigation]

**Analysis**:
- [Findings from investigation]
- [Contributing factors]
- [Why it wasn't caught earlier]

## Solution

[To be filled when implementing fix]

**Approach**:
- [High-level solution approach]
- [Files to be changed]
- [Expected impact]

**Implementation Details**:
```
[Code snippets, configuration changes, etc.]
```

## Verification

### Phase 1: Bug Verification
- [ ] Exact issue reproduced
- [ ] Fix applied
- [ ] Specific test case now passes
- [ ] No error in console
- [ ] Screenshot showing fixed state

### Phase 2: Regression Testing
- [ ] Related functionality tested
- [ ] Component tests passed
- [ ] No new issues introduced

### Phase 3: Integration Testing
- [ ] User journeys tested
- [ ] Cross-browser tested (if UI)
- [ ] Performance acceptable
- [ ] Accessibility maintained

## Sign-off

- **Fixed By**: [Developer name]
- **Fix Date**: YYYY-MM-DD
- **Verified By**: [Tester name]
- **Verification Date**: YYYY-MM-DD
- **Closed By**: [Team lead/PO name]
- **Close Date**: YYYY-MM-DD

## Related Issues

- Related to: #ISS-XXX
- Blocks: #ISS-YYY
- Blocked by: #ISS-ZZZ
- Duplicate of: DEF-YYYY-AAA

## Notes

[Any additional context, learnings, or follow-up items]

---

## Template Usage Guide

### Severity Guidelines

- **P0 - Critical**: System crash, data loss, security breach, complete feature failure
  - Fix timeline: 24 hours
  - Example: Application won't load, database corrupted

- **P1 - Major**: Core feature broken, major functionality impaired, workaround exists
  - Fix timeline: 48-72 hours
  - Example: Dashboard filters not working, IPO data not loading

- **P2 - Minor**: Non-core features affected, UX degraded, no data loss
  - Fix timeline: Current sprint (1-2 weeks)
  - Example: Slow sorting, minor visual glitches

- **P3 - Trivial**: Cosmetic issues, typos, minor inconsistencies
  - Fix timeline: Future release (when time allows)
  - Example: Button alignment, color inconsistency

### Status Lifecycle

1. **NEW**: Defect just logged, awaiting triage
2. **ASSIGNED**: Triaged and assigned to developer
3. **OPEN**: Developer actively working on fix
4. **FIXED**: Fix implemented, awaiting verification
5. **VERIFIED**: Fix confirmed working, ready to close
6. **CLOSED**: Resolved and approved

### Best Practices

- Be specific in reproduction steps
- Include all relevant evidence
- Test workarounds before reporting
- Update status promptly
- Link related issues
- Document root cause for learning
