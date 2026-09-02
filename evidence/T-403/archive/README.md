# Superseded — do not read as current

These are the round-2 evidence generations, kept only so the record of what was
claimed then is not erased. They were produced against a database built from a
dump, before the round-3 fixes, and their acceptance checks are the ones the
round-3 review found were asserting the code's behaviour rather than the
contract — in particular the A5 "zero non-exchange calls" check, which passed
only because the SEBI rung could never fire.

`round2-db-run/` is the round-2 `--db` generation; the loose files beside it are
the earlier in-memory generation.

The current evidence is one level up: `../README.md` and `../db-run/`.
