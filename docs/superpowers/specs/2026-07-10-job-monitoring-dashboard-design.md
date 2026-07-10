# Job Monitoring Dashboard — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorming) — ready for implementation plan

## Summary

Redesign the job-management monitoring section (what you see after selecting a
submitted job in the manage view) into a single, cohesive, **status-aware
dashboard**. Today it is a stack of separately-styled HTML fragments emitted by
shell retrievers; the redesign unifies them under one shared design system,
adds a visible color-coded status indicator, and improves refresh/freshness and
empty-state handling. Data plumbing is largely unchanged — the numbers are fine;
this is visual + status + behavior, with light readability touches.

## Goals

- **Status indicator:** a visible, color-coded job-status badge (currently the
  status is a hidden field that only drives conditions).
- **Visual redesign:** one unified dashboard panel (status header + responsive
  grid of stat tiles), one design language across sstat / node util / seff.
- **Refresh behavior:** freshness stamps, honest empty/first-sample states, keep
  the existing no-flash refresh.
- **Reach:** shared across **all** environments via `runtime_support/`.

## Non-goals

- No move to a React monitor component / JSON retrievers (explicitly chose to
  evolve the shell-emits-HTML pattern).
- No new resource metrics / data sources (data is fine as-is).
- No changes to `StaticText.js` React (keep the current no-flash refresh + spinner).
- Rolling the schema changes out to *other* environments' `manage.schema.json`
  (in the external `dor-hprc-drona-environments` repo) is a follow-up; we
  prototype in Generic.

## Architecture

Keep the existing pattern: a retriever `.sh` → fills an HTML template
(`{{PLACEHOLDER}}` substitution) → rendered by `staticText` with `allowHtml`
(`dangerouslySetInnerHTML`, confirmed). Introduce **one shared design system**:

- A **new always-visible status-header section** (`condition: !jobs.`) renders
  from `drona_info_slurmstatus.sh` and **owns the single `<style id="drona-monitor">`
  block** defining the whole design system (tokens, cards, tiles, badges,
  progress bars).
- All other templates (sstat, node util, seff) emit **only classed markup**, no
  per-file `<style>`. They inherit the header's styles. Because the header always
  renders above them, the CSS is guaranteed present and injected once — no
  duplication, no per-fragment style drift.
- Design tokens are a **self-contained light palette** matching the app (surface
  `#ffffff`, border `#cbd5e1`, text `#0f172a`, accent maroon `#500000`, plus the
  state colors). No dependency on the (removed) site theme system.

### Resolution model (why `runtime_support/` is "shared")

`views/schema_routes.py` resolves a retriever from the **env dir first**, then
falls back to `runtime_support/retriever_scripts/`. Templates are always pulled
from `$DRONA_RUNTIME_DIR/html_templates/` (= `<repo>/runtime_support/html_templates`).
So editing `runtime_support/` reaches every env — *except* where an env ships its
own shadowing copy of a script.

## Status header + status states

Full-width bar at the top of the panel:

```
●  RUNNING        Job 12345 · main.sh        updated 12:04:33 · elapsed 00:42:10 · 1 node
```

- **Left:** color-coded badge + dot. RUNNING gets a live pulse. Colors:
  RUNNING green, PENDING amber, COMPLETED blue, FAILED red, CANCELLED grey,
  TIMEOUT orange, OUT_OF_MEMORY red.
- **Right:** job id · name, elapsed, node count, and the freshness stamp.

**Retriever change — `drona_info_slurmstatus.sh`:**
- Fix the `$statud` typo.
- Emit the *real* state: `squeue -j $JOBID -h -o %T` for active jobs; when squeue
  is empty (job finished), fall back to `sacct -j $JOBID -o State -n -P` and
  normalize (strip trailing `+`, map `OUT_OF_ME+`/`OUT_OF_MEMORY`, etc.) to a
  single token: `PENDING|RUNNING|COMPLETED|FAILED|CANCELLED|TIMEOUT|OUT_OF_MEMORY`.
- Also surface job id/name, elapsed, node count, and an `updated` timestamp
  (`date +%T`) for the header.

**Condition ripple (must update together):** conditions currently key off
`status.RUNNING` and `status.DONE`. Once real terminal states are emitted,
`status.DONE` no longer matches. Update the schema:
- sstat / node util / cgroups detail → stay on `status.RUNNING`.
- seff "Job Summary" → terminal states (`COMPLETED|FAILED|TIMEOUT|OUT_OF_MEMORY|CANCELLED`).

## Stat-tile grid (sstat) and shared language

Replace the sstat `glass-card` with a responsive grid of **stat tiles** sharing
the header's design system:

```
┌ RESOURCE UTILIZATION ─────────────────────── ↻ 20s · updated 12:04:33 ┐
│  MEMORY          CPU TIME        DISK I/O        PAGES                 │
│  2.1G / 1.8G     00:40 / 00:12   1.2G ▸ 340M     12 / 8                │
│  max / ave       ave / min       read / write    max / ave            │
│  ▓▓▓▓▓▓░░░░      ▓▓▓▓▓▓▓░░░       ▓▓▓░░░░░░░                           │
│  VM 3.4G         4 tasks          —               2.4GHz               │
└───────────────────────────────────────────────────────────────────────┘
```

- Each tile: label (small caps), big mono value (primary/secondary pair),
  sub-caption naming the pair, a progress bar where a ratio is meaningful
  (memory used vs peak, cpu ave/min), and a foot line for metadata (VM, tasks, freq).
- **Same fields, no new data.** Readability only: normalize units (K/M → human
  G/M), tidy time formats, keep the existing I/O overflow guard. Empty/`0K`
  values render as a muted `—`, not a hard zero.
- Progress bars carry the accent/state color, tying tiles to the header.

**Applied across:** node utilization and seff (Job Summary) get the identical
tile/card system — seff efficiency numbers (CPU%, mem%) become tiles with
progress bars. Logs and the cgroups detail panel keep their structure but adopt
the shared card frame/heading so they visually belong.

## Refresh, freshness & empty states

- **Freshness stamp:** each card header shows the poll interval and an
  `updated HH:MM:SS` timestamp the retriever emits; the header's pulsing dot
  signals active polling for RUNNING.
- **First-sample / empty state:** when a retriever has no data yet (sstat right
  after launch, or a step that hasn't reported), the tile shows a muted
  "collecting first samples…" instead of a wall of `0K`/`0B` — driven by the
  retriever's default-value check, so it distinguishes "no data yet" from
  "genuinely zero."
- **No-flash refresh kept as-is:** `StaticText` keeps old content across polls
  and overlays a small spinner. React untouched. (Optional future tweak:
  restyle that spinner into a subtler inline "updating…"; out of scope now.)
- **Terminal states stop polling naturally:** once terminal, the live pulse
  stops and the RUNNING-only sections drop out via their conditions; seff's
  Job Summary takes over — no sstat polling on a dead job.

## Files touched

**Shared — `runtime_support/` (reaches all envs):**
- **NEW** `html_templates/slurm-status-template.html` — status header; owns
  `<style id="drona-monitor">`.
- `retriever_scripts/drona_info_slurmstatus.sh` — typo fix; squeue→sacct
  fallback; emit state + job id/name/elapsed/nodes + `updated`.
- `html_templates/slurm-sstat-template.html` — rebuild as tile grid; drop `<style>`.
- `html_templates/slurm-nodeutil-template.html`, `slurm-seff-template.html` —
  restyle to shared tiles.
- `html_templates/slurm-logs-template.html`, `slurm_cgroups_template.html` —
  adopt shared card frame/heading.
- Matching retrievers (`drona_slurm_sstat.sh`, `drona_slurm_nodeutil.sh`,
  `drona_slurm_seff.sh`) — unit normalization, empty-state defaults, `updated`
  timestamp.

**Per-env schema — Generic prototype (`environments/Generic/schemas/manage.schema.json`):**
- Add a `status_header` section (`condition: !jobs.`, renders
  `drona_info_slurmstatus.sh`, `allowHtml`, sensible refresh interval).
- Update conditions per the ripple above.

**Caveats:**
- **Shadowing:** Generic ships its own `drona_slurm_seff.sh` (shadows the shared
  one) — apply the seff edit in the env copy, or delete it to adopt the shared
  version. Audit other envs for shadowing copies before rollout.
- Schema edits (status header + condition update) are two small blocks; the same
  apply to other envs' `manage.schema.json` in `dor-hprc-drona-environments` —
  follow-up after Generic proves out.

## Testing / verification

- Shell retrievers: run each with a known JOBID (running + finished) and assert
  the emitted HTML contains the expected tokens/classes and normalized values;
  assert terminal states resolve via sacct; assert empty sstat → "collecting
  first samples…" not zeros.
- Status normalization: table-test squeue-empty + assorted `sacct State` strings
  → normalized tokens.
- Visual: exercise the Generic manage view against a live running job and a
  finished job (this repo runs under OOD; the user drives it), confirming the
  status header, tiles, freshness stamp, and state-driven section visibility.
- Confirm no `<style>` duplication and that the single design system renders
  identically across sstat / node util / seff.

## Open decisions deferred

- Exact refresh interval for the new status header (start ~15s).
- Whether to delete Generic's shadowing `drona_slurm_seff.sh` vs edit it in place
  (decide during implementation once we diff it against the shared one).
