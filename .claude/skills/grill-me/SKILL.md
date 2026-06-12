---
name: grill-me
description: >
  Interview the user relentlessly about a plan, decision, or ambiguous request
  until shared understanding is reached — one question at a time, each with a
  recommended answer. Use when intent confidence is below ~95% on a
  consequential fork, or whenever the user says "grill me" / asks to be
  questioned before work proceeds. For the docs-aware variant that also updates
  CONTEXT.md and ADRs, use /grill-with-docs.
type: workflow
allowed-tools: "Read Grep Glob AskUserQuestion"
argument-hint: "[plan, decision, or topic to grill]"
version: "1.0.0"
---

# Grill Me

Interview the user about every unresolved aspect of the topic until shared
understanding is reached. Walk down each branch of the decision tree, resolving
dependencies between decisions one-by-one.

**What to grill:** $ARGUMENTS

## Rules

1. **One question at a time.** Ask a single question, wait for the answer, then
   ask the next. Never batch questions.
2. **Codebase first.** Before asking anything, check whether the codebase,
   docs, logs, or config can answer it. Only ask what you cannot resolve
   yourself.
3. **Always recommend.** Every question comes with a recommended answer and a
   one-line reason. Use AskUserQuestion with the recommended option first,
   labeled "(Recommended)".
4. **Only consequential forks.** Skip questions whose answer would not change
   what you do next. Reversible, internal, best-practice-clear details are
   yours to decide (see `.claude/rules/decision-authority.md`) — do not grill
   on decidable defaults.
5. **Stress-test with scenarios.** When the user's answer is fuzzy, probe with
   a concrete scenario that forces precision ("If X happens on a Sunday run,
   should the job skip or queue?").
6. **Sharpen terminology.** When the user uses an overloaded term, propose the
   precise one and confirm.
7. **Stop at confidence.** End the loop the moment you can state the goal in
   one unambiguous sentence and no consequential fork remains. Summarize the
   resolved decisions, state remaining assumptions as `**Assumption:** X`,
   then proceed with the work.

## Exit contract

When grilling ends, output:

- **Resolved:** bullet list of decision → answer
- **Assumptions:** anything proceeding un-asked
- **Next action:** the work that now starts
