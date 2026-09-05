#!/usr/bin/env python3
"""W-141 - PreToolUse hook (matcher: Bash).

Local mirror of the mechanical gate in scripts/deploy/require-release-branch.sh
+ the CI step in .github/workflows/deploy-linux.yml: a prod deploy is only
ever dispatched with an explicit `--ref release/prod-<date>`. This hook
catches the mistake at the point Claude is ABOUT to run the `gh` command
(before spending an Actions run and hitting the CI-side refusal), never
replaces the CI gate.

Reads the Claude Code PreToolUse hook JSON from stdin:
  {"tool_name": "Bash", "tool_input": {"command": "..."}, ...}

Exit codes:
  0 - allow (also used on any parse error - fail OPEN, never block on a
      shape we don't understand; a one-line note goes to stderr so the
      miss is visible without stopping the user's work)
  2 - block (message on stderr, fed back to Claude per the PreToolUse
      "exit 2 = block" convention documented in dangerous-command-blocker.sh)

Root-cause note: the CI step is the actual enforcement (it cannot be
bypassed - it reads github.ref + verifies ancestry from git, not from
anything the dispatch command claims). This hook is a cheap pre-flight
convenience layer only; it deliberately does the LOOSER "does the command
text contain --ref release/prod-" substring check (not a real branch/sha
ancestry check - it has no repo to check ancestry against at the point a
Bash tool call is being considered) and is explicitly allowed to be wrong
in the permissive direction. It must never be treated as the gate.
"""

import json
import re
import sys


def has_field_form(command: str, field: str, value: str) -> bool:
    """True if `command` sets a gh -f/--field/-F <field>=<value> (or that
    same key/value via a JSON body, e.g. `-f slot=prod` or `"slot": "prod"`).
    """
    # -f slot=prod / --field slot=prod / -F slot=prod
    flag_pattern = re.compile(
        r"(?:-f|-F|--field)\s+" + re.escape(field) + r"\s*=\s*" + re.escape(value)
    )
    if flag_pattern.search(command):
        return True

    # JSON body form: "slot": "prod" (allow flexible whitespace/quoting)
    json_pattern = re.compile(
        r'["\']' + re.escape(field) + r'["\']\s*:\s*["\']' + re.escape(value) + r'["\']'
    )
    if json_pattern.search(command):
        return True

    return False


def main() -> int:
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
    except (json.JSONDecodeError, ValueError) as exc:
        sys.stderr.write(f"deploy-branch-guard: fail-open (could not parse hook JSON: {exc})\n")
        return 0

    try:
        tool_name = payload.get("tool_name", "")
        if tool_name != "Bash":
            return 0

        tool_input = payload.get("tool_input", {})
        command = tool_input.get("command", "") if isinstance(tool_input, dict) else ""
        if not isinstance(command, str) or not command:
            return 0

        if "gh workflow run" not in command or "deploy-linux.yml" not in command:
            return 0

        if not has_field_form(command, "slot", "prod"):
            return 0

        # It's a prod dispatch of deploy-linux.yml - the ONLY allowed shape
        # also carries an explicit release/prod-* ref.
        if "--ref release/prod-" in command or re.search(r"--ref[=\s]+release/prod-", command):
            return 0

        sys.stderr.write(
            "BLOCKED (deploy-branch-guard): a prod deploy of deploy-linux.yml must be "
            "dispatched with --ref release/prod-<date> (docs/ops/branching-model.md Rule 1 - "
            "'nothing reaches production except a commit on a release/prod-<date> branch'). "
            "Correct shape:\n"
            "  gh workflow run deploy-linux.yml --ref release/prod-<date> "
            "-f slot=prod -f ref=<sha>\n"
            "Cut the release branch first if one does not exist yet for today's deploy. "
            "This is a local convenience check only - the real, unbypassable gate is the "
            "'Require release/prod-* branch for a prod deploy' step in "
            ".github/workflows/deploy-linux.yml (scripts/deploy/require-release-branch.sh).\n"
        )
        return 2
    except Exception as exc:  # noqa: BLE001 - fail-open on any unexpected shape
        sys.stderr.write(f"deploy-branch-guard: fail-open (unexpected error: {exc})\n")
        return 0


if __name__ == "__main__":
    sys.exit(main())
