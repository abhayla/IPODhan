"""Runs the offer-document answer-key gate (offer_doc_gate.py) under pytest.

Skips, with an explicit reason, when the reader cache is absent, so CI shows "skipped: cache absent" and never a
pass it did not earn. With the cache present the gate must exit 0; any NOT RUN (cache misses, missing documents)
or gate failure fails the test with the gate's own output.
"""
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
GATE = os.path.join(HERE, 'offer_doc_gate.py')
DEFAULT_CACHE = 'D:/Abhay/Ventures/IPODhan-doc-cache/reader-cache'


def _cache_folder():
    return os.environ.get('OFFER_DOC_CACHE') or DEFAULT_CACHE


def test_offer_document_answer_key_gate():
    folder = _cache_folder()
    if not os.path.isdir(folder) or not any(f.endswith('.cache.json') for f in os.listdir(folder)):
        pytest.skip('offer-document reader cache absent: %s (set OFFER_DOC_CACHE)' % folder)
    proc = subprocess.run([sys.executable, GATE], capture_output=True, text=True, encoding='utf8', timeout=900)
    assert proc.returncode == 0, 'gate exit %s\n%s\n%s' % (proc.returncode, proc.stdout[-6000:], proc.stderr[-2000:])
