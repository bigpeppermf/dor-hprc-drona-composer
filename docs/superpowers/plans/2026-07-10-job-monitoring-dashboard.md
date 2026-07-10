# Job Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the job-management monitoring section into a unified, status-aware dashboard: one shared design system, a color-coded job-status header, restyled resource tiles, and honest freshness/empty states — all via the existing shell-emits-HTML pattern so every environment benefits.

**Architecture:** Retriever `.sh` scripts fill `{{PLACEHOLDER}}` HTML templates rendered by `staticText`/`allowHtml` (`dangerouslySetInnerHTML`). A new always-visible status-header template owns the single `<style id="drona-monitor">` design system; all other templates emit only classed markup and inherit it. State detection (squeue → sacct fallback) is factored into a sourceable library shared by the hidden-status field and the header.

**Tech Stack:** Bash (retrievers), HTML/CSS (templates), JSON (schema). Slurm CLIs: `squeue`, `sacct`, `sstat`, `seff`, `scontrol`, `srun`.

## Global Constraints

- Design system is a **self-contained light palette** — no CSS variables/theme tokens (the site theme system was removed). Surface `#ffffff`, border `#cbd5e1`, text `#0f172a`, muted `#64748b`, accent maroon `#500000`.
- State token set (exact strings): `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELLED`, `TIMEOUT`, `OUT_OF_MEMORY`, plus `UNKNOWN` fallback.
- State colors: RUNNING `#10b981`, PENDING `#f59e0b`, COMPLETED `#3b82f6`, FAILED `#ef4444`, CANCELLED `#64748b`, TIMEOUT `#f97316`, OUT_OF_MEMORY `#ef4444`.
- Only the status-header template may contain a `<style>` block. All other templates emit classed markup only.
- Templates are read from `$DRONA_RUNTIME_DIR/html_templates/`; retrievers resolve from the env dir first, then `runtime_support/retriever_scripts/`.
- No changes to `src/` React (keep `StaticText` no-flash refresh + spinner). No new resource metrics.
- Commit after each task. Do NOT push. No self-attribution in commit messages (no `Co-Authored-By`, no "Generated with" footer).
- Shared CSS class prefix: `dm-` (drona-monitor).

## Test approach

Retrievers call Slurm CLIs that don't exist in this dev environment, so tests **stub** them on `PATH`. A shared helper creates temp stub executables. Tests run with plain bash and assert on emitted stdout (grep for expected tokens/classes). No bats dependency.

Create `runtime_support/tests/_stub_helpers.sh` in Task 1 and reuse it.

---

### Task 1: State-detection library

**Files:**
- Create: `runtime_support/retriever_scripts/drona_slurm_state_lib.sh`
- Create: `runtime_support/tests/_stub_helpers.sh`
- Test: `runtime_support/tests/test_state_lib.sh`

**Interfaces:**
- Produces: `drona_detect_state <jobid>` — echoes exactly one normalized state token from the Global Constraints set. Sourceable (no side effects on source).

- [ ] **Step 1: Write the stub helper**

Create `runtime_support/tests/_stub_helpers.sh`:

```bash
#!/bin/bash
# Test helper: create a temp dir of stub executables and prepend to PATH.
# Usage:
#   source _stub_helpers.sh
#   make_stub squeue 'echo "RUNNING"'
#   make_stub sacct  'exit 0'
#   use_stubs   # prepends stub dir to PATH
#   ... run retriever ...
#   cleanup_stubs
STUB_DIR="$(mktemp -d)"
make_stub() {
  local name="$1"; local body="$2"
  printf '#!/bin/bash\n%s\n' "$body" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}
use_stubs() { PATH="$STUB_DIR:$PATH"; }
cleanup_stubs() { rm -rf "$STUB_DIR"; }
assert_eq() {
  local got="$1"; local want="$2"; local msg="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $msg — got [$got] want [$want]"; exit 1
  fi
  echo "ok: $msg"
}
assert_contains() {
  local hay="$1"; local needle="$2"; local msg="$3"
  if [[ "$hay" != *"$needle"* ]]; then
    echo "FAIL: $msg — output missing [$needle]"; exit 1
  fi
  echo "ok: $msg"
}
```

- [ ] **Step 2: Write the failing test**

Create `runtime_support/tests/test_state_lib.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
LIB="$DIR/../retriever_scripts/drona_slurm_state_lib.sh"

# Active job: squeue returns RUNNING
make_stub squeue 'echo "RUNNING"'; make_stub sacct 'exit 0'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "RUNNING" "active RUNNING via squeue"
cleanup_stubs

# Finished job: squeue empty, sacct FAILED
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "FAILED"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "FAILED" "terminal FAILED via sacct"
cleanup_stubs

# OOM normalization (sacct long form)
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "OUT_OF_MEMORY"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "OUT_OF_MEMORY" "OOM normalized"
cleanup_stubs

# CANCELLED with trailing text (e.g. "CANCELLED by 0")
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "CANCELLED by 0"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "CANCELLED" "CANCELLED by trimmed"
cleanup_stubs

# Nothing anywhere -> UNKNOWN
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'exit 0'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "UNKNOWN" "no data -> UNKNOWN"
cleanup_stubs
echo "ALL PASS"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bash runtime_support/tests/test_state_lib.sh`
Expected: FAIL (library file does not exist / `drona_detect_state: command not found`).

- [ ] **Step 4: Write the library**

Create `runtime_support/retriever_scripts/drona_slurm_state_lib.sh`:

```bash
#!/bin/bash
# Shared Slurm job-state detection. Source this; do not execute.
# drona_detect_state <jobid> -> one of:
#   PENDING RUNNING COMPLETED FAILED CANCELLED TIMEOUT OUT_OF_MEMORY UNKNOWN
drona_detect_state() {
  local jobid="$1"
  local s
  # Active jobs: squeue knows them; %T is the long state name.
  s=$(squeue -j "$jobid" -h -o "%T" 2>/dev/null | head -n1)
  if [[ -z "$s" ]]; then
    # Finished jobs: fall back to accounting.
    s=$(sacct -j "$jobid" -o State -n -P 2>/dev/null | head -n1)
  fi
  s="${s%%+*}"     # strip trailing '+' (truncated long states)
  s="${s%% *}"     # take first word ("CANCELLED by 0" -> "CANCELLED")
  case "$s" in
    PENDING|PD)         echo "PENDING" ;;
    RUNNING|R)          echo "RUNNING" ;;
    COMPLETED|CD)       echo "COMPLETED" ;;
    FAILED|F)           echo "FAILED" ;;
    CANCELLED|CA)       echo "CANCELLED" ;;
    TIMEOUT|TO)         echo "TIMEOUT" ;;
    OUT_OF_ME*|OOM)     echo "OUT_OF_MEMORY" ;;
    "")                 echo "UNKNOWN" ;;
    *)                  echo "$s" ;;
  esac
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_state_lib.sh`
Expected: prints `ok:` lines then `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add runtime_support/retriever_scripts/drona_slurm_state_lib.sh runtime_support/tests/_stub_helpers.sh runtime_support/tests/test_state_lib.sh
git commit -m "Add shared Slurm state-detection library with squeue->sacct fallback"
```

---

### Task 2: Bare-token status retriever uses the library

**Files:**
- Modify: `runtime_support/retriever_scripts/drona_info_slurmstatus.sh` (full rewrite)
- Test: `runtime_support/tests/test_slurmstatus.sh`

**Interfaces:**
- Consumes: `drona_detect_state` (Task 1).
- Produces: `drona_info_slurmstatus.sh` prints exactly one state token on stdout (used by the `status` hidden field; conditions test `status.RUNNING`, `status.COMPLETED`, etc.).

- [ ] **Step 1: Write the failing test**

Create `runtime_support/tests/test_slurmstatus.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_info_slurmstatus.sh"

make_stub squeue 'exit 0'; make_stub sacct 'echo "COMPLETED"'; use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_eq "$OUT" "COMPLETED" "terminal COMPLETED emitted as bare token"
cleanup_stubs
echo "ALL PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash runtime_support/tests/test_slurmstatus.sh`
Expected: FAIL — current script emits `DONE` (and has the `$statud` typo), not `COMPLETED`.

- [ ] **Step 3: Rewrite the retriever**

Replace `runtime_support/retriever_scripts/drona_info_slurmstatus.sh` with:

```bash
#!/bin/bash
# Emits the normalized Slurm state token for $JOBID (used by the hidden
# `status` field that drives section conditions).
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/drona_slurm_state_lib.sh"
drona_detect_state "$JOBID"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash runtime_support/tests/test_slurmstatus.sh`
Expected: `ok:` then `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add runtime_support/retriever_scripts/drona_info_slurmstatus.sh runtime_support/tests/test_slurmstatus.sh
git commit -m "Emit real Slurm terminal states from status retriever"
```

---

### Task 3: Shared design system + status header

**Files:**
- Create: `runtime_support/html_templates/slurm-status-template.html`
- Create: `runtime_support/retriever_scripts/drona_slurm_status_header.sh`
- Test: `runtime_support/tests/test_status_header.sh`

**Interfaces:**
- Consumes: `drona_detect_state` (Task 1).
- Produces: `drona_slurm_status_header.sh` prints HTML containing the `<style id="drona-monitor">` block and a `.dm-status-header` with a `.dm-badge dm-badge--<state>` element. Shared classes (contract for later tasks): `dm-card`, `dm-title`, `dm-grid`, `dm-tile`, `dm-tile-label`, `dm-tile-val`, `dm-tile-sub`, `dm-tile-foot`, `dm-bar`, `dm-bar-fill`, `dm-bar--cpu|mem|io|accent`, `dm-updated`, `dm-empty`, `dm-dot`.

- [ ] **Step 1: Write the failing test**

Create `runtime_support/tests/test_status_header.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_status_header.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

make_stub squeue 'echo "RUNNING"'
make_stub sacct 'exit 0'
make_stub scontrol 'exit 0'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'id="drona-monitor"' "shared style block present"
assert_contains "$OUT" 'dm-badge--running' "running badge class present"
assert_contains "$OUT" 'RUNNING' "state label present"
assert_contains "$OUT" 'dm-status-header' "header container present"
cleanup_stubs
echo "ALL PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash runtime_support/tests/test_status_header.sh`
Expected: FAIL — template/retriever do not exist.

- [ ] **Step 3: Create the status-header template (owns the design system)**

Create `runtime_support/html_templates/slurm-status-template.html`:

```html
<div class="drona-monitor">
<style id="drona-monitor">
  .drona-monitor { font-family: 'Inter', system-ui, sans-serif; color: #0f172a; }
  .drona-monitor .dm-card {
    position: relative; background: #ffffff; border: 1px solid #cbd5e1;
    border-radius: 14px; padding: 22px 18px 16px; margin-top: 14px;
    box-shadow: 0 4px 10px -4px rgba(15,23,42,0.12);
  }
  .drona-monitor .dm-title {
    position: absolute; top: -11px; left: 18px; background: #ffffff;
    padding: 2px 12px; font-size: 10px; font-weight: 800; color: #475569;
    text-transform: uppercase; letter-spacing: 2px; border: 1px solid #cbd5e1;
    border-radius: 20px; display: flex; align-items: center; gap: 7px;
  }
  .drona-monitor .dm-updated { font-weight: 600; color: #94a3b8; letter-spacing: 0.4px; }
  .drona-monitor .dm-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #10b981;
    box-shadow: 0 0 8px currentColor; color: #10b981;
  }
  .drona-monitor .dm-dot--pulse { animation: dm-pulse 2s infinite; }
  @keyframes dm-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* Status header */
  .drona-monitor .dm-status-header {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    background: #ffffff; border: 1px solid #cbd5e1; border-radius: 12px;
    padding: 12px 16px; margin-top: 14px;
  }
  .drona-monitor .dm-badge {
    display: inline-flex; align-items: center; gap: 8px; font-weight: 800;
    font-size: 13px; letter-spacing: 0.5px; padding: 6px 12px; border-radius: 999px;
    color: #fff;
  }
  .drona-monitor .dm-badge .dm-dot { background: #fff; color: #fff; box-shadow: none; }
  .dm-badge--running   { background: #10b981; }
  .dm-badge--pending   { background: #f59e0b; }
  .dm-badge--completed { background: #3b82f6; }
  .dm-badge--failed    { background: #ef4444; }
  .dm-badge--cancelled { background: #64748b; }
  .dm-badge--timeout   { background: #f97316; }
  .dm-badge--oom       { background: #ef4444; }
  .dm-badge--unknown   { background: #94a3b8; }
  .drona-monitor .dm-status-meta {
    display: flex; gap: 18px; flex-wrap: wrap; margin-left: auto;
    font-size: 12px; color: #475569;
  }
  .drona-monitor .dm-status-meta b { color: #0f172a; font-family: 'JetBrains Mono', monospace; font-weight: 700; }

  /* Tile grid (used by sstat / node util / seff) */
  .drona-monitor .dm-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
  }
  .drona-monitor .dm-tile {
    border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 12px 10px;
    background: #ffffff; display: flex; flex-direction: column; gap: 4px;
  }
  .drona-monitor .dm-tile-label { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px; }
  .drona-monitor .dm-tile-val { font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 800; color: #0f172a; }
  .drona-monitor .dm-tile-val .sub { color: #94a3b8; font-size: 14px; font-weight: 600; }
  .drona-monitor .dm-tile-sub { font-size: 10px; color: #94a3b8; }
  .drona-monitor .dm-tile-foot { font-size: 10px; color: #64748b; margin-top: 2px; }
  .drona-monitor .dm-bar { height: 6px; background: #f1f5f9; border-radius: 3px; overflow: hidden; margin-top: 4px; }
  .drona-monitor .dm-bar-fill { height: 100%; border-radius: 3px; }
  .dm-bar--cpu    { background: linear-gradient(90deg,#3b82f6,#60a5fa); }
  .dm-bar--mem    { background: linear-gradient(90deg,#10b981,#34d399); }
  .dm-bar--io     { background: linear-gradient(90deg,#f59e0b,#fbbf24); }
  .dm-bar--accent { background: #500000; }
  .drona-monitor .dm-empty { font-size: 12px; color: #94a3b8; font-style: italic; padding: 6px 0; }
</style>

  <div class="dm-status-header">
    <span class="dm-badge dm-badge--{{STATE_CLASS}}">
      <span class="dm-dot {{PULSE}}"></span>{{STATE}}
    </span>
    <div class="dm-status-meta">
      <span>Job <b>{{JOB_ID}}</b></span>
      <span>{{JOB_NAME}}</span>
      <span>elapsed <b>{{ELAPSED}}</b></span>
      <span><b>{{NODES}}</b></span>
      <span class="dm-updated">updated {{UPDATED}}</span>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Create the header retriever**

Create `runtime_support/retriever_scripts/drona_slurm_status_header.sh`:

```bash
#!/bin/bash
# Renders the status-header HTML (owns the shared design system) for $JOBID.
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/drona_slurm_state_lib.sh"
HTML_TEMPLATE="${HTML_TEMPLATE:-$DRONA_RUNTIME_DIR/html_templates/slurm-status-template.html}"

STATE="$(drona_detect_state "$JOBID")"
STATE_CLASS="$(echo "$STATE" | tr '[:upper:]' '[:lower:]')"
[[ "$STATE_CLASS" == "out_of_memory" ]] && STATE_CLASS="oom"

# Live pulse only while running.
PULSE=""; [[ "$STATE" == "RUNNING" ]] && PULSE="dm-dot--pulse"

# Extra fields (best-effort; blank if unavailable).
JOB_NAME="$(squeue -j "$JOBID" -h -o '%j' 2>/dev/null | head -n1)"
ELAPSED="$(squeue -j "$JOBID" -h -o '%M' 2>/dev/null | head -n1)"
NCOUNT="$(squeue -j "$JOBID" -h -o '%D' 2>/dev/null | head -n1)"
if [[ -z "$ELAPSED" ]]; then
  ELAPSED="$(sacct -j "$JOBID" -o Elapsed -n -P 2>/dev/null | head -n1)"
fi
[[ -z "$JOB_NAME" ]] && JOB_NAME="—"
[[ -z "$ELAPSED" ]] && ELAPSED="—"
if [[ -n "$NCOUNT" ]]; then NODES="$NCOUNT node(s)"; else NODES="—"; fi
UPDATED="$(date +%T)"

while IFS= read -r line; do
  line="${line//\{\{STATE_CLASS\}\}/$STATE_CLASS}"
  line="${line//\{\{STATE\}\}/$STATE}"
  line="${line//\{\{PULSE\}\}/$PULSE}"
  line="${line//\{\{JOB_ID\}\}/$JOBID}"
  line="${line//\{\{JOB_NAME\}\}/$JOB_NAME}"
  line="${line//\{\{ELAPSED\}\}/$ELAPSED}"
  line="${line//\{\{NODES\}\}/$NODES}"
  line="${line//\{\{UPDATED\}\}/$UPDATED}"
  printf '%s\n' "$line"
done < "$HTML_TEMPLATE"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_status_header.sh`
Expected: `ok:` lines then `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add runtime_support/html_templates/slurm-status-template.html runtime_support/retriever_scripts/drona_slurm_status_header.sh runtime_support/tests/test_status_header.sh
git commit -m "Add status header template + retriever owning the shared design system"
```

---

### Task 4: Rebuild sstat as the tile grid

**Files:**
- Modify: `runtime_support/html_templates/slurm-sstat-template.html` (full rewrite — remove own `<style>`, use `dm-` classes)
- Modify: `runtime_support/retriever_scripts/drona_slurm_sstat.sh` (add unit/empty normalization + `{{UPDATED}}`)
- Test: `runtime_support/tests/test_sstat.sh`

**Interfaces:**
- Consumes: shared classes from Task 3.
- Produces: HTML with `dm-card`, `dm-grid`, four `dm-tile`s; empty values render `dm-empty` "collecting first samples…".

- [ ] **Step 1: Write the failing test**

Create `runtime_support/tests/test_sstat.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_sstat.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

# Case 1: sstat returns data
make_stub sstat 'echo "2048K|1024K|3.4G|00:40|00:12|500M|340M|4|12|8|2.4GHz"'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'dm-grid' "tile grid present"
assert_contains "$OUT" 'dm-tile' "tiles present"
assert_contains "$OUT" 'MEMORY' "memory tile label"
cleanup_stubs

# Case 2: sstat returns nothing -> empty state, not a wall of zeros
source "$DIR/_stub_helpers.sh"
make_stub sstat 'exit 0'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'collecting first samples' "empty state shown"
cleanup_stubs
echo "ALL PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash runtime_support/tests/test_sstat.sh`
Expected: FAIL — current template has no `dm-grid`, no empty-state text.

- [ ] **Step 3: Rewrite the sstat template**

Replace `runtime_support/html_templates/slurm-sstat-template.html` with:

```html
<div class="drona-monitor">
  <div class="dm-card">
    <div class="dm-title"><span class="dm-dot dm-dot--pulse"></span> Resource Utilization
      <span class="dm-updated">· ↻20s · updated {{UPDATED}}</span>
    </div>
    {{BODY}}
  </div>
</div>
```

The retriever emits either a `dm-grid` of tiles or a single `dm-empty` line into `{{BODY}}`.

- [ ] **Step 4: Rewrite the sstat retriever**

Replace `runtime_support/retriever_scripts/drona_slurm_sstat.sh` with:

```bash
#!/bin/bash
# Renders the sstat resource-utilization tiles for $JOBID.
HTML_TEMPLATE="${HTML_TEMPLATE:-$DRONA_RUNTIME_DIR/html_templates/slurm-sstat-template.html}"

# MaxRSS,AveRSS,MaxVMSize,AveCPU,MinCPU,AveDiskRead,AveDiskWrite,NTasks,MaxPages,AvePages,AveCPUFreq
RAW=$(sstat -j "$JOBID".batch --format=MaxRSS,AveRSS,MaxVMSize,AveCPU,MinCPU,AveDiskRead,AveDiskWrite,NTasks,MaxPages,AvePages,AveCPUFreq -n -P 2>/dev/null)
IFS='|' read -r MAX_RSS AVE_RSS MAX_VM AVE_CPU MIN_CPU A_READ A_WRITE N_TASKS MAX_PAGE AVE_PAGE CPU_FREQ <<< "$RAW"

UPDATED="$(date +%T)"

# Guard against the sstat I/O overflow bug (huge bogus M values -> 0B).
clean_io() {
  local val="$1"
  if [[ $val == *M ]]; then
    local num="${val%M}"
    if (( ${num%.*} > 1000000 )); then echo "0B"; return; fi
  fi
  echo "$val"
}
# Muted dash for empty/zero-ish values.
dash() { local v="$1"; if [[ -z "$v" || "$v" == "0" || "$v" == "0K" || "$v" == "0B" ]]; then echo "—"; else echo "$v"; fi; }
# Size string (e.g. 2048K, 1.5G) -> bytes (integer).
to_bytes() {
  local v="$1"; [[ -z "$v" ]] && { echo 0; return; }
  local num="${v%[KMGTkmgt]*}"; local unit="${v: -1}"
  awk -v n="$num" -v u="$unit" 'BEGIN{
    m=1; if(u=="K"||u=="k")m=1024; else if(u=="M"||u=="m")m=1048576;
    else if(u=="G"||u=="g")m=1073741824; else if(u=="T"||u=="t")m=1099511627776;
    if(n=="")n=0; printf "%.0f", n*m }'
}
# Time string (mm:ss or hh:mm:ss or d-hh:mm:ss) -> seconds.
to_secs() {
  local v="$1"; [[ -z "$v" ]] && { echo 0; return; }
  local days=0; if [[ "$v" == *-* ]]; then days="${v%%-*}"; v="${v#*-}"; fi
  awk -v d="$days" -v t="$v" 'BEGIN{
    n=split(t,a,":"); s=0;
    if(n==3)s=a[1]*3600+a[2]*60+a[3]; else if(n==2)s=a[1]*60+a[2]; else s=a[1];
    printf "%d", d*86400+s }'
}
# Percent of part/whole, clamped 0..100 (0 if whole is 0). Real ratio for the bars.
pct() {
  awk -v p="$1" -v w="$2" 'BEGIN{ if(w+0==0){print 0} else {r=100*p/w; if(r>100)r=100; if(r<0)r=0; printf "%d", r} }'
}

if [[ -z "$RAW" ]]; then
  BODY='<div class="dm-empty">Collecting first samples…</div>'
else
  R_READ="$(dash "$(clean_io "$A_READ")")"
  R_WRITE="$(dash "$(clean_io "$A_WRITE")")"
  # Meaningful ratios from existing fields (spec: bars only where a ratio means something).
  MEM_PCT="$(pct "$(to_bytes "$AVE_RSS")" "$(to_bytes "$MAX_RSS")")"
  CPU_PCT="$(pct "$(to_secs "$MIN_CPU")" "$(to_secs "$AVE_CPU")")"
  # Disk I/O and Pages have no natural denominator -> no bar (values only).
  BODY=$(cat <<HTML
<div class="dm-grid">
  <div class="dm-tile">
    <span class="dm-tile-label">Memory</span>
    <span class="dm-tile-val">$(dash "$MAX_RSS") <span class="sub">/ $(dash "$AVE_RSS")</span></span>
    <span class="dm-tile-sub">max / ave · ave is ${MEM_PCT}% of max</span>
    <div class="dm-bar"><div class="dm-bar-fill dm-bar--mem" style="width:${MEM_PCT}%"></div></div>
    <span class="dm-tile-foot">VM $(dash "$MAX_VM")</span>
  </div>
  <div class="dm-tile">
    <span class="dm-tile-label">CPU Time</span>
    <span class="dm-tile-val">$(dash "$AVE_CPU") <span class="sub">/ $(dash "$MIN_CPU")</span></span>
    <span class="dm-tile-sub">ave / min · min is ${CPU_PCT}% of ave</span>
    <div class="dm-bar"><div class="dm-bar-fill dm-bar--cpu" style="width:${CPU_PCT}%"></div></div>
    <span class="dm-tile-foot">${N_TASKS:-0} tasks</span>
  </div>
  <div class="dm-tile">
    <span class="dm-tile-label">Disk I/O</span>
    <span class="dm-tile-val">$R_READ <span class="sub">▸ $R_WRITE</span></span>
    <span class="dm-tile-sub">read / write</span>
    <span class="dm-tile-foot">&nbsp;</span>
  </div>
  <div class="dm-tile">
    <span class="dm-tile-label">Pages</span>
    <span class="dm-tile-val">$(dash "$MAX_PAGE") <span class="sub">/ $(dash "$AVE_PAGE")</span></span>
    <span class="dm-tile-sub">max / ave</span>
    <span class="dm-tile-foot">${CPU_FREQ:-—}</span>
  </div>
</div>
HTML
)
fi

while IFS= read -r line; do
  line="${line//\{\{UPDATED\}\}/$UPDATED}"
  line="${line//\{\{BODY\}\}/$BODY}"
  printf '%s\n' "$line"
done < "$HTML_TEMPLATE"
```

Note: `{{BODY}}` contains multiline HTML; because the replacement runs per-line and `$BODY` has newlines, the whole block is inserted at the `{{BODY}}` line. Verify in Step 5.

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_sstat.sh`
Expected: `ok:` lines then `ALL PASS`. Also eyeball: `JOBID=123 DRONA_RUNTIME_DIR=runtime_support bash runtime_support/retriever_scripts/drona_slurm_sstat.sh` (with an sstat stub) prints well-formed HTML with four tiles.

- [ ] **Step 6: Commit**

```bash
git add runtime_support/html_templates/slurm-sstat-template.html runtime_support/retriever_scripts/drona_slurm_sstat.sh runtime_support/tests/test_sstat.sh
git commit -m "Rebuild sstat as shared tile grid with empty-state handling"
```

---

### Task 5: Restyle node utilization to shared tiles

**Files:**
- Modify: `runtime_support/html_templates/slurm-nodeutil-template.html` (remove own `<style>`, use shared card + grid)
- Modify: `runtime_support/retriever_scripts/drona_slurm_nodeutil.sh` (emit `dm-tile` cards + `{{UPDATED}}`, empty state)
- Test: `runtime_support/tests/test_nodeutil.sh`

**Interfaces:**
- Consumes: shared classes from Task 3.
- Produces: HTML with `dm-card` + `dm-grid` of per-node `dm-tile`s.

- [ ] **Step 1: Write the failing test**

Create `runtime_support/tests/test_nodeutil.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_nodeutil.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

make_stub squeue 'case "$*" in *"%N"*) echo "n001";; *"%C"*) echo "8";; *) echo "";; esac'
make_stub scontrol 'echo "n001"'
make_stub srun 'echo "10.0"'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'dm-grid' "grid present"
assert_contains "$OUT" 'dm-tile' "node tile present"
assert_contains "$OUT" 'n001' "node name present"
cleanup_stubs
echo "ALL PASS"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash runtime_support/tests/test_nodeutil.sh`
Expected: FAIL — current template uses `.node-card`, not `dm-` classes.

- [ ] **Step 3: Rewrite the node util template**

Replace `runtime_support/html_templates/slurm-nodeutil-template.html` with:

```html
<div class="drona-monitor">
  <div class="dm-card">
    <div class="dm-title"><span class="dm-dot dm-dot--pulse"></span> Node Utilization
      <span class="dm-updated">· updated {{UPDATED}}</span>
    </div>
    {{BODY}}
  </div>
</div>
```

- [ ] **Step 4: Rewrite the node util retriever**

Replace the tail of `runtime_support/retriever_scripts/drona_slurm_nodeutil.sh` so it emits shared tiles. Full file:

```bash
#!/bin/bash
# Renders per-node CPU/RAM utilization tiles for $JOBID.
HTML_TEMPLATE="${HTML_TEMPLATE:-$DRONA_RUNTIME_DIR/html_templates/slurm-nodeutil-template.html}"
UPDATED="$(date +%T)"

NODES=$(squeue -j "$JOBID" -h -o "%N" 2>/dev/null)
HOSTS=$(scontrol show hostnames "$NODES" 2>/dev/null)

TILES=""
for HOST in $HOSTS; do
  CPU_RAW=$(srun --jobid="$JOBID" -w "$HOST" --overlap --ntasks=1 \
    ps -u "$USER" -o %cpu= 2>/dev/null | awk '{s+=$1} END {print s+0}')
  MEM_MB=$(srun --jobid="$JOBID" -w "$HOST" --overlap --ntasks=1 \
    ps -u "$USER" -o rss= 2>/dev/null | awk '{s+=$1} END {printf "%.0f", s/1024}')
  CPU_INT="${CPU_RAW%.*}"; [[ -z "$CPU_INT" ]] && CPU_INT=0
  CPU_BAR=$(( CPU_INT > 100 ? 100 : CPU_INT ))
  TILES+="<div class='dm-tile'>"
  TILES+="<span class='dm-tile-label'>$HOST</span>"
  TILES+="<span class='dm-tile-val'>${CPU_RAW:-0}<span class='sub'>% cpu</span></span>"
  TILES+="<div class='dm-bar'><div class='dm-bar-fill dm-bar--cpu' style='width:${CPU_BAR}%'></div></div>"
  TILES+="<span class='dm-tile-foot'>RAM ${MEM_MB:-0} MB</span>"
  TILES+="</div>"
done

if [[ -z "$TILES" ]]; then
  BODY='<div class="dm-empty">No node data yet…</div>'
else
  BODY="<div class=\"dm-grid\">$TILES</div>"
fi

while IFS= read -r line; do
  line="${line//\{\{UPDATED\}\}/$UPDATED}"
  line="${line//\{\{BODY\}\}/$BODY}"
  printf '%s\n' "$line"
done < "$HTML_TEMPLATE"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_nodeutil.sh`
Expected: `ok:` lines then `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add runtime_support/html_templates/slurm-nodeutil-template.html runtime_support/retriever_scripts/drona_slurm_nodeutil.sh runtime_support/tests/test_nodeutil.sh
git commit -m "Restyle node utilization to shared tile grid"
```

---

### Task 6: Restyle seff (Job Summary) + fix template-path bug + handle shadowing

**Files:**
- Modify: `runtime_support/html_templates/slurm-seff-template.html` (remove own `<style>`, use shared tiles)
- Modify: `runtime_support/retriever_scripts/drona_slurm_seff.sh` (fix `$HTMLTEMPLATE` typo; emit `dm-tile`s)
- Delete OR edit: `/scratch/user/u.rs353319/drona_wfe/environments/Generic/drona_slurm_seff.sh` (shadow copy)
- Test: `runtime_support/tests/test_seff.sh`

**Interfaces:**
- Consumes: shared classes from Task 3.
- Produces: HTML with `dm-card` + per-job `dm-tile`s for CPU% and Mem% with `dm-bar` fills.

- [ ] **Step 1: Write the failing test**

Create `runtime_support/tests/test_seff.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_seff.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

make_stub seff 'printf "CPU Efficiency: 85.2%% of 1-00:00:00 core-walltime\nMemory Efficiency: 42.0%% of 4.00 GB\n"'
use_stubs
OUT=$(JOBIDS=123 bash "$SCRIPT")
assert_contains "$OUT" 'dm-tile' "seff tiles present"
assert_contains "$OUT" '85.2' "cpu efficiency present"
assert_contains "$OUT" 'dm-bar-fill' "efficiency bar present"
cleanup_stubs
echo "ALL PASS"
```

Note: `JOBIDS` is passed as a space-separated string here; the retriever iterates it with `for`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bash runtime_support/tests/test_seff.sh`
Expected: FAIL — current retriever reads `$HTMLTEMPLATE` (empty) and uses non-`dm-` classes.

- [ ] **Step 3: Rewrite the seff template**

Replace `runtime_support/html_templates/slurm-seff-template.html` with:

```html
<div class="drona-monitor">
  <div class="dm-card">
    <div class="dm-title"><span class="dm-dot"></span> Job Summary</div>
    {{BODY}}
  </div>
</div>
```

- [ ] **Step 4: Rewrite the seff retriever**

Replace `runtime_support/retriever_scripts/drona_slurm_seff.sh` with:

```bash
#!/bin/bash
# Renders seff CPU/memory efficiency tiles for each job id in $JOBIDS.
HTML_TEMPLATE="${HTML_TEMPLATE:-$DRONA_RUNTIME_DIR/html_templates/slurm-seff-template.html}"

bar_class() {
  local pct="${1%%.*}"; [[ -z "$pct" ]] && pct=0
  if   (( pct > 70 )); then echo "dm-bar--mem"
  elif (( pct > 30 )); then echo "dm-bar--io"
  else echo "dm-bar--accent"; fi
}

TILES=""
for JID in $JOBIDS; do
  OUT=$(seff "$JID" 2>/dev/null)
  [[ -z "$OUT" ]] && continue
  CPU_EFF=$(echo "$OUT" | grep "CPU Efficiency"    | awk '{print $3}' | tr -d '%')
  MEM_EFF=$(echo "$OUT" | grep "Memory Efficiency" | awk '{print $3}' | tr -d '%')
  [[ -z "$CPU_EFF" ]] && CPU_EFF=0
  [[ -z "$MEM_EFF" ]] && MEM_EFF=0
  TILES+="<div class='dm-tile'><span class='dm-tile-label'>Job $JID · CPU</span>"
  TILES+="<span class='dm-tile-val'>${CPU_EFF}<span class='sub'>%</span></span>"
  TILES+="<span class='dm-tile-sub'>efficiency</span>"
  TILES+="<div class='dm-bar'><div class='dm-bar-fill $(bar_class "$CPU_EFF")' style='width:${CPU_EFF}%'></div></div></div>"
  TILES+="<div class='dm-tile'><span class='dm-tile-label'>Job $JID · Memory</span>"
  TILES+="<span class='dm-tile-val'>${MEM_EFF}<span class='sub'>%</span></span>"
  TILES+="<span class='dm-tile-sub'>efficiency</span>"
  TILES+="<div class='dm-bar'><div class='dm-bar-fill $(bar_class "$MEM_EFF")' style='width:${MEM_EFF}%'></div></div></div>"
done

if [[ -z "$TILES" ]]; then
  BODY='<div class="dm-empty">No summary available.</div>'
else
  BODY="<div class=\"dm-grid\">$TILES</div>"
fi

while IFS= read -r line; do
  line="${line//\{\{BODY\}\}/$BODY}"
  printf '%s\n' "$line"
done < "$HTML_TEMPLATE"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_seff.sh`
Expected: `ok:` lines then `ALL PASS`.

- [ ] **Step 6: Remove the shadowing copy so Generic uses the shared seff**

Diff first, then delete the env-local shadow so the shared version is used:

```bash
diff /scratch/user/u.rs353319/drona_wfe/environments/Generic/drona_slurm_seff.sh runtime_support/retriever_scripts/drona_slurm_seff.sh || true
rm /scratch/user/u.rs353319/drona_wfe/environments/Generic/drona_slurm_seff.sh
```

(That path is outside the repo — it won't be part of the commit. Note it in the commit body.)

- [ ] **Step 7: Commit**

```bash
git add runtime_support/html_templates/slurm-seff-template.html runtime_support/retriever_scripts/drona_slurm_seff.sh runtime_support/tests/test_seff.sh
git commit -m "Restyle seff to shared tiles, fix template-path bug; drop Generic seff shadow (env dir)"
```

---

### Task 7: Logs + cgroups adopt the shared card frame

**Files:**
- Modify: `runtime_support/html_templates/slurm-logs-template.html` (wrap in `dm-card` + `dm-title`, drop bespoke frame styling)
- Modify: `runtime_support/html_templates/slurm_cgroups_template.html` (same)
- Test: `runtime_support/tests/test_frames.sh`

**Interfaces:**
- Consumes: shared classes from Task 3. No retriever logic change — only the wrapping frame.

- [ ] **Step 1: Read both templates**

Run: `cat runtime_support/html_templates/slurm-logs-template.html runtime_support/html_templates/slurm_cgroups_template.html`
Note the `{{PLACEHOLDER}}` names each uses (do not rename them — the retrievers substitute them).

- [ ] **Step 2: Write the failing test**

Create `runtime_support/tests/test_frames.sh`:

```bash
#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
for f in slurm-logs-template.html slurm_cgroups_template.html; do
  C=$(cat "$DIR/../html_templates/$f")
  assert_contains "$C" 'drona-monitor' "$f wrapped in drona-monitor"
  assert_contains "$C" 'dm-card' "$f uses shared card"
  if [[ "$C" == *"<style"* ]]; then echo "FAIL: $f still has its own <style>"; exit 1; fi
  echo "ok: $f has no local <style>"
done
echo "ALL PASS"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bash runtime_support/tests/test_frames.sh`
Expected: FAIL — templates not yet wrapped / still contain `<style>`.

- [ ] **Step 4: Wrap both templates**

For each, wrap the existing content body (keep its `{{PLACEHOLDER}}`s intact) as:

```html
<div class="drona-monitor">
  <div class="dm-card">
    <div class="dm-title"><span class="dm-dot"></span> Output / Error Logs</div>
    <!-- existing body with its {{PLACEHOLDER}} kept as-is, local <style> removed -->
  </div>
</div>
```

Use the title "Output / Error Logs" for `slurm-logs-template.html` and "Process Detail" for `slurm_cgroups_template.html`. Remove any local `<style>` block; if the body relied on a bespoke class for layout that has no shared equivalent, keep that one rule inline on the element via `style="…"` rather than reintroducing a `<style>` block.

- [ ] **Step 5: Run test to verify it passes**

Run: `bash runtime_support/tests/test_frames.sh`
Expected: `ok:` lines then `ALL PASS`.

- [ ] **Step 6: Commit**

```bash
git add runtime_support/html_templates/slurm-logs-template.html runtime_support/html_templates/slurm_cgroups_template.html runtime_support/tests/test_frames.sh
git commit -m "Wrap logs + cgroups panels in the shared card frame"
```

---

### Task 8: Wire the status header + fix conditions in Generic's manage schema

**Files:**
- Modify: `/scratch/user/u.rs353319/drona_wfe/environments/Generic/schemas/manage.schema.json`

(Outside the repo — not committed here. This is the per-env prototype; the same edits later propagate to `dor-hprc-drona-environments`.)

**Interfaces:**
- Consumes: `drona_slurm_status_header.sh` (Task 3), terminal state tokens (Task 2).

- [ ] **Step 1: Add the status_header section**

Insert this block after `hidden_jobdir_path` (before `workingDirectory`) in `manage.schema.json`:

```json
  "status_header": {
    "type": "rowContainer",
    "condition": "!jobs.",
    "elements": {
      "status_header_html": {
        "type": "staticText",
        "name": "status_header",
        "label": "",
        "isDynamic": true,
        "allowHtml": true,
        "refreshInterval": "15",
        "showRefreshButton": false,
        "retrieverParams": { "JOBID": "$jobs" },
        "retriever": "drona_slurm_status_header.sh"
      }
    }
  },
```

- [ ] **Step 2: Update the seff condition to terminal states**

In `job_summary_section`, change:

```json
    "condition": "!allworkflows. && !status. && status.DONE && !jobs.",
```

to:

```json
    "condition": "!allworkflows. && !status. && !jobs. && (status.COMPLETED || status.FAILED || status.TIMEOUT || status.OUT_OF_MEMORY || status.CANCELLED)",
```

- [ ] **Step 3: Verify the sstat/util conditions still gate on RUNNING**

Confirm `sstat_section`, `utilization_section`, and `utilization_detail_section` keep `status.RUNNING` in their `condition` (no change needed — just verify).

- [ ] **Step 4: Validate JSON**

Run: `python3 -m json.tool /scratch/user/u.rs353319/drona_wfe/environments/Generic/schemas/manage.schema.json > /dev/null && echo "valid JSON"`
Expected: `valid JSON`.

- [ ] **Step 5: Live smoke test (user-driven)**

Reload the composer, select the running example job in the manage view. Confirm: status header shows a green pulsing RUNNING badge with job id/elapsed/updated; the sstat + node util tiles render in the shared style; cancel the job (or wait) and confirm the badge flips to a terminal state, sstat/util drop out, and Job Summary (seff) appears.

- [ ] **Step 6: Note completion**

No repo commit for this task (file is outside the repo). Record in the final summary that Generic's `manage.schema.json` was updated and needs propagating to `dor-hprc-drona-environments`.

---

## Self-Review

**Spec coverage:**
- Shared design system + single `<style>` ownership → Task 3. ✅
- Status header + full color-coded states → Tasks 1–3. ✅
- squeue→sacct fallback + typo fix → Tasks 1–2. ✅
- Condition ripple (`status.DONE` → terminal) → Task 8. ✅
- sstat tile grid + units/empty → Task 4. ✅
- Node util + seff restyle to tiles → Tasks 5–6. ✅
- Logs + cgroups shared frame → Task 7. ✅
- Freshness stamp (`updated`) → Tasks 3–5. ✅
- Shadowing (Generic seff) → Task 6 Step 6. ✅
- No React changes / no new metrics → respected throughout. ✅

**Placeholder scan:** No TBD/TODO. Task 7's wrap shows the exact frame; the only intentional variability is preserving each template's existing `{{PLACEHOLDER}}` (read in Step 1) — that's a read-then-preserve instruction, not a code placeholder.

**Type/name consistency:** `drona_detect_state` used identically in Tasks 1/2/3. Shared classes (`dm-card`, `dm-grid`, `dm-tile`, `dm-bar-fill`, `dm-badge--*`, `dm-empty`, `dm-updated`) defined in Task 3 and consumed verbatim in Tasks 4–7. State tokens match the Global Constraints set in Tasks 1, 2, 8. `{{BODY}}`/`{{UPDATED}}` placeholders consistent between each template and its retriever.
