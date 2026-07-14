#!/usr/bin/env python3
"""Regression test for the ``runtime:`` schema-library $ref scheme.

Exercises the real ``views.schema_routes.make_schema_loader`` against the
shared library under ``runtime_support/schema_library/`` so that reusable
form-element blocks (the job-monitoring dashboard) keep resolving for any
environment that references them.

Run standalone (no pytest needed):
    /scratch/data/drona-venv/bin/python3 runtime_support/tests/test_schema_library_ref.py
Exits non-zero on the first failed assertion.
"""
import json
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, REPO_ROOT)

import jsonref  # noqa: E402
import views.schema_routes as sr  # noqa: E402

RUNTIME_DIR = os.path.join(REPO_ROOT, "runtime_support")


def _resolve(schema_str, base_dir):
    """Resolve a schema string the way get_schema_route does."""
    loader = sr.make_schema_loader()
    base_uri = "file:///" + os.path.abspath(base_dir).lstrip("/").replace(os.sep, "/") + "/"
    result = jsonref.loads(schema_str, base_uri=base_uri, loader=loader, proxies=True)
    return sr.convert_jsonref_to_dict(result)


def _patch_runtime_dir():
    """Point the library at this checkout's runtime_support regardless of
    how get_runtime_dir() would resolve in a live app."""
    sr.get_runtime_dir = lambda: RUNTIME_DIR


def test_whole_file_ref_splices_monitoring_sections():
    schema = json.dumps({
        "envSelect": {"type": "dynamicSelect", "name": "allworkflows"},
        "monitoring": {
            "type": "container",
            "elements": {"$ref": "runtime:monitoring/manage.snippet.json"},
        },
    })
    d = _resolve(schema, REPO_ROOT)
    mon = d["monitoring"]["elements"]
    expected = {"hidden_jobs_check", "hidden_status_check", "status_header",
                "sstat_section", "chart_section", "utilization_section",
                "job_summary_section", "logCollapse", "utilization_detail_section"}
    missing = expected - set(mon)
    assert not missing, f"monitoring sections missing after ref: {missing}"
    assert d["envSelect"]["name"] == "allworkflows", "env-local element must survive"


def test_terminal_state_conditions_present():
    schema = json.dumps({"m": {"type": "container",
                               "elements": {"$ref": "runtime:monitoring/manage.snippet.json"}}})
    cond = _resolve(schema, REPO_ROOT)["m"]["elements"]["job_summary_section"]["condition"]
    assert "COMPLETED" in cond and "DONE" not in cond, \
        f"job_summary must key on terminal states, got: {cond}"


def test_fragment_ref_selects_one_section():
    schema = json.dumps({
        "just_header": {"$ref": "runtime:monitoring/manage.snippet.json#/status_header",
                        "condition": "!jobs."},
    })
    hdr = _resolve(schema, REPO_ROOT)["just_header"]
    assert hdr["type"] == "rowContainer", "fragment ref should select status_header only"
    assert hdr["condition"] == "!jobs.", "sibling keys must override the referenced block"


def test_escape_is_rejected():
    loader = sr.make_schema_loader()
    try:
        loader("runtime:../../etc/passwd")
    except sr.APIError as e:
        assert e.status_code == 400
        return
    raise AssertionError("path-escaping runtime: ref was not rejected")


def test_missing_ref_is_404():
    loader = sr.make_schema_loader()
    try:
        loader("runtime:monitoring/does-not-exist.json")
    except sr.APIError as e:
        assert e.status_code == 404
        return
    raise AssertionError("missing runtime: ref did not raise 404")


def main():
    _patch_runtime_dir()
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passing")


if __name__ == "__main__":
    main()
