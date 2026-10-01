"""The answer state of every field the document extractor emits (#1420, F-219).

Spec: data-sourcing-pull-model.md section 6, rule 4, the answer-state table
(OD-153, OD-158). What a newer reader answers for a field decides what happens
to a value an older reader stored, so the envelope must say WHICH answer it is.
Before this module the extractor sent a missed label, a refused value and a
stated absence out in the same shape (a null), and two of them as a PASSING
check (F-219), so no consumer could tell them apart.

    VALUE               read, every check passed
    REFUSED             a value was read and a validation rule rejected it;
                        the refused value is carried in `refused_value`
    STATED_NOT_PRINTED  the document itself states the field does not apply or
                        is not printed; ONLY reasons on the shared allow-list
                        (scraper/src/config/stated-absence-reasons.json)
    MISSED              the reader found nothing (pattern miss, absent input)
    LOW_CONFIDENCE_OCR  the field's page was read by OCR below the floor

The two mistakes are not symmetric. OD-153/OD-158 CLEAR a stored value on
REFUSED and STATED_NOT_PRINTED, and keep it on MISSED. Calling a miss a refusal
or an absence would erase a good stored value; calling a refusal a miss only
leaves an old value in place one cycle longer. So anything not positively known
to be a refusal or a stated absence is MISSED: a failed check is REFUSED only
when it returned the `Refused` marker, and a null is STATED_NOT_PRINTED only
when its reason is on the allow-list AND was decided from the field's own cell.
"""

import json
import os

VALUE = "VALUE"
REFUSED = "REFUSED"
STATED_NOT_PRINTED = "STATED_NOT_PRINTED"
MISSED = "MISSED"
LOW_CONFIDENCE_OCR = "LOW_CONFIDENCE_OCR"

ALL_STATES = (VALUE, REFUSED, STATED_NOT_PRINTED, MISSED, LOW_CONFIDENCE_OCR)

STATED_ABSENCE_REASONS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "src", "config", "stated-absence-reasons.json")


def _load_stated_absence_reasons(path=STATED_ABSENCE_REASONS_PATH):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return frozenset(entry["reason"] for entry in data["reasons"])


# Read once at import. A missing or malformed file raises here, at startup:
# an empty allow-list would silently turn every stated absence into a miss.
STATED_ABSENCE_REASONS = _load_stated_absence_reasons()


class Missed(tuple):
    """A check result for an ABSENT input: the check could not be judged.

    A tuple subclass, so `passed, detail = result` and `result == (False, d)`
    keep working for every existing caller and test; only `answer_state`
    looks at the type. `passed` defaults to False (today's shape); a check
    whose callers read "not checkable" as None keeps None.
    """

    def __new__(cls, detail, passed=False):
        return tuple.__new__(cls, (passed, detail))


def missed(detail, passed=False):
    return Missed(detail, passed)


class Refused(tuple):
    """A check result that POSITIVELY rejects a value it was given (OD-153).

    The opt-in marker for REFUSED: `check_state` answers REFUSED only for this
    type. A plain `(False, detail)` - every inline presence check, every check
    nobody has audited - is MISSED, because REFUSED clears a stored value and
    MISSED keeps it. A check returns `refused(...)` only on a branch reached
    after every input it judges was present. Compares equal to (False, detail).
    """

    def __new__(cls, detail):
        return tuple.__new__(cls, (False, detail))


def refused(detail):
    return Refused(detail)


def judge(present, ok, detail):
    """An inline rule over a field's own value: MISSED when the value (or any
    input the rule reads) is absent, VALUE when the rule holds, REFUSED when a
    present value breaks it."""
    if not present:
        return missed(detail)
    return (True, detail) if ok else refused(detail)


def null_state(reason):
    """The state of a field emitted with no value and reason `reason`."""
    return STATED_NOT_PRINTED if reason in STATED_ABSENCE_REASONS else MISSED


def check_state(value, check_result):
    """The state of a field emitted through a check."""
    if isinstance(check_result, Missed):
        return MISSED
    if value is None or value == [] or value == {} or value == "":
        # Nothing was read: nothing to publish and nothing to refuse.
        return MISSED
    if check_result[0]:
        return VALUE
    # Opt-in: only a check that positively rejected a present value refuses.
    return REFUSED if isinstance(check_result, Refused) else MISSED
