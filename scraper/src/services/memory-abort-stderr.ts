/**
 * W-137 / W-142: the stderr signatures of a memory-aborted python child.
 *
 * Extracted from `filing-auto-persist.ts` (which still re-exports every name,
 * unchanged) so the anchor sidecar path in `anchor-investors-scraper.ts` can
 * classify a killed child the SAME way the filing extractor does without
 * importing the auto-persist service — that import would close a cycle
 * (filing-auto-persist -> anchor-auto-persist -> anchor-investors-scraper).
 * One definition, two callers, no second copy of the regex to drift.
 */

/** Round 4: stderr signatures of a memory failure that killed the extractor
 * at the C level, before Python (or even `memory_guard`) could run any
 * handler — so exit code and stdout carry NO information at all. Matched
 * case-insensitively against the captured stderr tail regardless of exit
 * code: `OpenBLAS error` / `Memory allocation still failed` (numpy's BLAS
 * backend under RLIMIT_AS, seen live on the VPS at EXTRACTOR_MAX_RSS_MB=200),
 * `MemoryError` / `memory ceiling exceeded` / `Cannot allocate memory` (the
 * ordinary Python-catchable shapes, matched here too as a backstop in case a
 * future change to the CLI's own handler regresses), `std::bad_alloc` (a C++
 * dependency's own OOM exception), and `Killed` (the shell's own message
 * when the kernel OOM-killer — not RLIMIT_AS — still gets there first).
 *
 * Round 5 (MINOR-1): `Killed` was unanchored and case-insensitive, so it also
 * matched unrelated stderr text containing "skilled" or "killed by user"
 * (e.g. a worker-pool log line). Anchored to the whole word with `\b` and
 * pulled out of the case-insensitive flag via a separate case-sensitive
 * alternation, since the shell's own message is always capitalized `Killed`.
 * `MemoryError` is similarly narrowed to only match an actual Python
 * exception line (`MemoryError` at the start of a traceback line, or
 * followed by `:` as in `MemoryError: ...`), not any incidental mention of
 * the word (e.g. inside a comment or an unrelated log string). */
export const MEMORY_ABORT_STDERR_RE =
  /Memory allocation still failed|OpenBLAS error|(^|\n)MemoryError(:|\n|$)|memory ceiling exceeded|Cannot allocate memory|std::bad_alloc/i;
/** Round 5 (MINOR-1): kept case-sensitive and word-boundary-anchored, and
 * OUTSIDE `MEMORY_ABORT_STDERR_RE`'s `i` flag on purpose — a JS regex literal
 * cannot mix case sensitivity per-alternative, and the shell's OOM-killer
 * message is always capitalized `Killed`. Folding it in case-insensitively
 * (the previous shape) also matched "skilled"-style substrings and lowercase
 * "killed" inside unrelated prose. Combined with `MEMORY_ABORT_STDERR_RE` via
 * `isMemoryAbortStderr()` below — always use that, not this regex alone. */
export const MEMORY_ABORT_KILLED_RE = /\bKilled\b/;

/** The single check callers use: true when the captured stderr tail carries
 * ANY known C-level memory-abort or OOM-kill signature — see the two
 * constants above for what each half matches and why they cannot be one
 * regex literal. */
export function isMemoryAbortStderr(stderr: string): boolean {
  return MEMORY_ABORT_STDERR_RE.test(stderr) || MEMORY_ABORT_KILLED_RE.test(stderr);
}
