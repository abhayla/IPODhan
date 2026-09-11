#!/usr/bin/env python3
"""Write the lane C ledger, progress log and board payload as ONE act - or fail.

WHY THIS EXISTS. Twice tonight the board fell behind the ledger: once by 44
minutes, once by 32. Both times a peer tick caught it, not me. The cause is
structural, not carelessness - I had been writing STATE.json and PROGRESS.md in
a single command (which is why those two never drifted from each other by more
than a minute) and treating the board as a separate, optional, easily-forgotten
step. The board is the copy the owner actually reads, so for those 76 minutes
the owner-facing artifact said less than my record did.

This is lane C's local version of item 1 slice s15 ("one command writes ledger,
progress log and board payload, or fails loudly"), which is not merged yet.

HOW THE COUPLING WORKS, given a tool boundary this script cannot cross. Writing
the board means calling the Artifact tool, which a shell script cannot do. So
instead of pretending to write it, this script:

  1. writes STATE.json and PROGRESS.md together, and refreshes the freshness
     marker in the same pass;
  2. writes the board payload to a known path, ready to hand to the Artifact
     call;
  3. drops a SENTINEL recording that a board write is owed;
  4. and REFUSES TO RUN AT ALL if a sentinel from a previous run is still
     there - i.e. if the last ledger write never got its board write.

So forgetting the board once costs nothing; forgetting it twice is impossible,
because the second ledger write fails with the first one's timestamp in the
error. That is the difference between a reminder and a gate.

Usage:
    lane-c-record.py --notes notes.json --progress progress.md --board board.json
    lane-c-record.py --clear-sentinel          # after the Artifact call lands
"""

import argparse
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE = os.path.join(ROOT, 'docs/contracts/state/pull-model-implementation-lane-c-STATE.json')
PROGRESS = os.path.join(ROOT, 'docs/contracts/.run/pull-model-implementation-lane-c-PROGRESS.md')
BOARD_OUT = os.path.join(ROOT, '.board-payload-owed.json')
SENTINEL = os.path.join(ROOT, '.board-write-owed')


def stamp():
    """Read the clock, never guess it - estimates drifted 80 minutes once."""
    return subprocess.check_output(['date', '+%Y-%m-%d %H:%M IST'], text=True).strip()


def refuse_if_owed():
    if not os.path.exists(SENTINEL):
        return
    owed = io.open(SENTINEL, encoding='utf-8').read().strip()
    sys.stderr.write(
        '\nREFUSING TO WRITE THE LEDGER.\n\n'
        f'  A board write has been owed since: {owed}\n\n'
        '  The previous ledger entry was written and its board payload never\n'
        '  reached the artifact, so the owner-facing copy is already behind.\n'
        '  Writing another ledger entry now would widen that gap silently.\n\n'
        '  Do this instead:\n'
        f'    1. Artifact write_db run/meta-c with {BOARD_OUT}\n'
        f'    2. {os.path.basename(__file__)} --clear-sentinel\n'
        '    3. re-run this command\n\n'
    )
    sys.exit(3)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--notes', help='JSON array of ledger note strings')
    ap.add_argument('--progress', help='markdown file appended to the progress log')
    ap.add_argument('--board', help='JSON object to hand to Artifact write_db run/meta-c')
    ap.add_argument('--clear-sentinel', action='store_true')
    args = ap.parse_args()

    if args.clear_sentinel:
        if os.path.exists(SENTINEL):
            os.remove(SENTINEL)
            print('sentinel cleared - board write recorded as done')
        else:
            print('no sentinel present; nothing to clear')
        return

    if not (args.notes and args.progress and args.board):
        sys.stderr.write('all three of --notes, --progress and --board are required: '
                         'that requirement IS the coupling\n')
        sys.exit(2)

    refuse_if_owed()
    ts = stamp()

    notes = json.load(io.open(args.notes, encoding='utf-8'))
    if not isinstance(notes, list) or not notes:
        sys.stderr.write('--notes must be a non-empty JSON array\n')
        sys.exit(2)

    d = json.load(io.open(STATE, encoding='utf-8'))
    d['notes'].extend(f'{ts} {n}' for n in notes)
    json.dump(d, io.open(STATE, 'w', encoding='utf-8', newline='\n'),
              indent=2, ensure_ascii=False)

    body = io.open(args.progress, encoding='utf-8').read()
    t = io.open(PROGRESS, encoding='utf-8', newline='').read()
    # The freshness marker is what a tick reads; it moves in this same pass or
    # the file lies about its own age.
    t = re.sub(r'\*\*Last refreshed: [^*]*\*\*', f'**Last refreshed: {ts}**', t, count=1)
    io.open(PROGRESS, 'w', encoding='utf-8', newline='').write(t + '\n\n' + body)

    board = json.load(io.open(args.board, encoding='utf-8'))
    board.setdefault('timestampSource', 'read from `date` by lane-c-record.py in this same pass')
    board['lastUpdate'] = subprocess.check_output(
        ['date', '+%Y-%m-%dT%H:%M:%S+05:30'], text=True).strip()
    json.dump(board, io.open(BOARD_OUT, 'w', encoding='utf-8', newline='\n'),
              indent=2, ensure_ascii=False)

    io.open(SENTINEL, 'w', encoding='utf-8').write(ts)

    print(f'ledger + progress written at {ts}; notes now {len(d["notes"])}')
    print(f'BOARD WRITE IS NOW OWED. Payload: {BOARD_OUT}')
    print('  Artifact write_db -> run/meta-c, then --clear-sentinel.')
    print('  The next ledger write REFUSES until you do.')


if __name__ == '__main__':
    main()
