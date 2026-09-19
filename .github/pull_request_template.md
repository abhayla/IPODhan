## Summary

<!-- what changed and why -->

## Test plan

<!-- how this was verified -->

## Spec deviation

<!-- Required. `.claude/rules/spec-adherence.md` decides the class in 30 seconds. -->

- **Class:** none / 1 (card defect) / 2 (minor) / 3 (major — this PR must not exist yet)
- **Spec section:** <the section of docs/design/data-sourcing-pull-model.md this touches, or n/a>
- **IPOs proven on (class 2 only):** <two differing IPOs per type touched, by name, registrar and date; or `unproven for type X`>
- **Card corrected in this PR:** yes / no / n/a

## Checklist

- [ ] fixes a live bug (label `fixes-live-bug`) — merging this without deploying leaves the bug live; the nightly `m_fix_merged_not_served` audit check (T-425, `scripts/audit-detection-floor.mjs`) pages if it isn't served within 24h
