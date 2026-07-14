# Runtime schema library

Reusable schema fragments (form-element blocks) shared by every environment,
so common UI — like the job-monitoring dashboard — lives in **one place**
instead of being copy-pasted into each env's `schema.json`.

An environment pulls a block in with a `$ref` using the `runtime:` scheme:

```json
"$ref": "runtime:<path-under-this-directory>"
```

The `runtime:` scheme resolves against this directory
(`runtime_support/schema_library/`) via a custom loader in
`views/schema_routes.py`, so schemas never hardcode an absolute install path.
It works exactly like the ordinary env-relative `$ref` (e.g.
`"$ref": "schemas/create.schema.json"`) — including JSON-pointer fragments and
sibling-key overrides — just resolved from the shared library.

## Monitoring dashboard — `monitoring/manage.snippet.json`

The full "manage" dashboard body: hidden job/status probes, status header,
Slurm summary, live resource-utilization tiles, finished-job summary (seff),
output/error logs, and the cancel/delete actions. The retriever scripts and
HTML templates it calls already live in `runtime_support/` and are shared the
same way (env-dir first, then `runtime_support/` fallback), so **nothing but
this ref is needed** to give a new env the whole dashboard.

### Drop the whole dashboard into a new env

The env only supplies the workflow picker (`envSelect`, which defines
`allworkflows` — the field every monitoring block keys off). Its
`schemas/manage.schema.json`:

```json
{
  "envSelect": {
    "type": "dynamicSelect",
    "label": "Select Workflow",
    "name": "allworkflows",
    "retriever": "drona_select_wf.sh"
  },
  "monitoring": {
    "type": "container",
    "elements": { "$ref": "runtime:monitoring/manage.snippet.json" }
  }
}
```

### Cherry-pick one section

Every top-level key in the snippet is addressable with a JSON-pointer fragment,
and sibling keys next to the `$ref` override the referenced block:

```json
"status_header": {
  "$ref": "runtime:monitoring/manage.snippet.json#/status_header",
  "condition": "!jobs."
}
```

Available sections: `hidden_jobs_check`, `hidden_status_check`,
`hidden_jobdir_path`, `status_header`, `workingDirectory`, `slurmrow`,
`sstat_section`, `chart_section`, `utilization_section`, `job_summary_section`,
`logCollapse`, `utilization_detail_section`, `action_select`,
`delete_dir_checkbox`.

### The utilization chart (`chart_section`)

`drona_slurm_chart.sh` emits a `<drona-chart>` element — declarative markup only,
no `<script>` and no `on*` handlers, because retriever HTML is rendered through
`dangerouslySetInnerHTML` (which never executes injected scripts). The component
that draws it is registered in `main.bundle.js` via a side-effect import in
`src/index.js`, so it is already defined before any retriever output arrives.
Custom elements *do* upgrade under innerHTML, which is what makes this work.

Two things follow from that, and they matter if you touch this:

- **Rebuild the bundle** (`npm run build`) after changing
  `src/webComponents/dronaChart.js`, or the page keeps the old component.
- **The shell ships data, not drawing.** Keep it that way — it's what keeps the
  retriever safe to render.

Sampling: `sstat` is point-in-time, so each poll appends one row to
`${XDG_CACHE_HOME:-$HOME/.cache}/drona/metrics/<jobid>.tsv` (capped at
`DRONA_METRICS_MAX_SAMPLES`, default 120). The chart needs 3 rows before it
draws, since CPU% is a rate. Derived series, both real and both 0-100 so they
share one axis:

- `CPU%  = Δcpu_seconds / (Δwall × AllocCPUS) × 100`
- `Mem%  = MaxRSS / ReqMem × 100` — omitted entirely when `ReqMem` is unknown,
  rather than showing a made-up percentage.

### Contract the snippet expects

- A field named **`allworkflows`** (the selected workflow) must exist in the
  form — provide it via `envSelect` as above.
- `job_summary_section` renders on terminal Slurm states
  (`COMPLETED / FAILED / TIMEOUT / OUT_OF_MEMORY / CANCELLED`), driven by the
  `drona_info_slurmstatus.sh` probe. Envs must **not** re-introduce the old
  `status.DONE` condition.

## Test

```
/scratch/data/drona-venv/bin/python3 runtime_support/tests/test_schema_library_ref.py
```

Exercises the real loader against this library (whole-file ref, fragment ref,
terminal-state conditions, path-escape and not-found guards).
