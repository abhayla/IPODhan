# Scope: global

# Every question and recommendation to the owner is verified against the spec first

version: "1.1.0" (1.1.0, owner 2026-09-23 evening: "whenever I provide you input, that additional
clarification should go back to the spec document"; portable copy `~/.claude/rules/spec-first.md`)
(1.0.0 owner directive 2026-09-23: "Make sure you provide your recommendation after
verifying existing spec for requirements and your recommendation should be inline with spec
requirements. Also create a rule for this.")

`docs/design/data-sourcing-pull-model.md` is the single source of truth (`spec-adherence.md`). A
question the spec already answers wastes the owner's time. A recommendation that contradicts the spec
asks the owner to overrule himself without telling him.

## Why this exists: five misses on 2026-09-23

- Seven identity scenarios were put to the owner before §2.3.3 was read. OD-34 and OD-35 had already
  decided most of them on 2026-09-09. One of the options offered ("match by ISIN first") was worse
  than the spec's own order, because ISIN arrives only near listing.
- The item 17 brief told a builder to add a separate document-reading path. §6.1 says "exactly the
  pull walk ... There is no separate code path". The off-spec build failed three independent
  reviews before anyone reread §6.1.
- A new reason code was recommended for 49 zero issue sizes before §1.11 was read. §1.11 already
  settles 17 of them (TENDER and BUYBACK are corporate actions, so issue size does not apply), and
  only the remaining 32 needed a decision.
- With this rule loaded, a closed-IPO re-pick question offered a timer. The spec already says "never
  on a backoff timer" (§2) and "once per STAGE CHANGE" (OD-56, OD-62, §2.5.1). Only §6.1/OD-78/OD-80
  (the job's own sections) had been read. The owner sent it back: "check the requirements first".
- A fingerprint question called `documentType` outside OD-78's wording before reading the spec's own
  definition of the `DOC` label (§1: "the IPO's own offer document, best available type"). Sent back.

The common cause: "the owning section" was read as ONE section. A subject usually has several.

## The rule

1. **Read first, by key terms.** Before asking the owner anything or recommending anything, grep the
   spec for EVERY key term of the subject: the field names, plan states, cause and reason codes, job
   names and source labels involved. Also check §0.0.1 (the OD rows), §1.11 (the per-type exceptions)
   and the definition of every source label used (§1). Read every hit that could constrain the
   answer. Put a `Spec basis:` line (sections + OD rows) inside the question text.
2. **Answered by the spec means no question.** If the spec already decides it, build to the spec and
   say so in one line. Asking anyway is a defect.
3. **The recommendation conforms to the spec.** The recommended option must follow the spec's stated
   requirements. If it has to depart from the spec, it is labelled as a spec change (class 3,
   `spec-adherence.md`), the conflicting text is quoted, and it says why.
4. **Only the real gap is asked.** When the spec settles part of a question, present that part as
   settled and ask only about what remains (for example, 17 rows settled by §1.11 and 32 asked about).
5. **Real scenarios, visible where the owner reads.** Each option carries real rows from prod or
   staging (names, numbers, dates), or says "no real case in N days" when there is none. Examples
   go inside the question's previews, because the owner often sees only the question box.
6. **Every owner answer lands in the spec before the code.** A decision, a clarification, a
   correction or an "I meant X": record it as an OD row in §0.0.1, plus the section text, in its own
   change or the same change as the code. Recording it only in an issue, a PR body or memory is not
   enough. If the spec already said it and was misread, reword the spec so it cannot be misread.
7. **A brief to a builder cites the spec section it implements.** A brief whose instructions
   contradict the spec is the supervisor's defect, not the builder's.
8. **"Check the spec" from the owner is a miss.** Record it, re-read per rule 1, and come back with
   the new recommendation and what changed.

## CRITICAL RULES

- MUST grep the spec by every key term of the subject (plus §0.0.1, §1.11 and the label definitions)
  before any owner question or recommendation, and put a `Spec basis:` line inside the question.
- MUST NOT ask what the spec already decides.
- MUST make the recommended option spec-conformant, or label it a spec change and quote the conflict.
- MUST show real rows per option, inside the question itself.
- MUST record every owner decision AND clarification as an OD row in the spec before or with the code.
- MUST cite the implemented spec section in every builder brief.
