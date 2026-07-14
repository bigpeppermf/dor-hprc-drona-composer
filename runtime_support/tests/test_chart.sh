#!/bin/bash
# Tests for drona_slurm_chart.sh + drona_slurm_metrics_lib.sh with stubbed Slurm.
cd "$(dirname "$0")" || exit 1
source ./_stub_helpers.sh

SCRIPTS="$(cd ../retriever_scripts && pwd)"
export DRONA_RUNTIME_DIR="$(cd .. && pwd)"

# Isolate history from the real user cache.
WORK="$(mktemp -d)"
export DRONA_METRICS_DIR="$WORK"
trap 'cleanup_stubs; rm -rf "$WORK"' EXIT

# 5G request, 1 CPU. sstat: 30s of CPU time, 1G RSS.
make_stub sacct 'echo "5G|1"'
make_stub sstat 'echo "00:30|1048576K"'
use_stubs

# --- unit: conversions -------------------------------------------------------
source "$SCRIPTS/drona_slurm_metrics_lib.sh"
assert_eq "$(drona_to_bytes 5G)" "5368709120" "to_bytes parses 5G"
assert_eq "$(drona_to_bytes '')" "0" "to_bytes of empty is 0"
assert_eq "$(drona_to_secs '00:30')" "30" "to_secs parses mm:ss"
assert_eq "$(drona_to_secs '01:00:00')" "3600" "to_secs parses hh:mm:ss"
assert_eq "$(drona_to_secs '1-00:00:00')" "86400" "to_secs parses d-hh:mm:ss"
assert_eq "$(drona_metrics_denoms 111)" "5368709120 1" "denoms read ReqMem+AllocCPUS"

# --- sacct only populates ReqMem on the parent row ---------------------------
make_stub sacct 'printf "5G|1\n|1\n|1\n"'
assert_eq "$(drona_metrics_denoms 111)" "5368709120 1" "denoms skip empty step rows"

# --- AllocCPUS floors at 1 (never divide by zero) ----------------------------
make_stub sacct 'echo "5G|0"'
read -r _ a <<< "$(drona_metrics_denoms 111)"
assert_eq "$a" "1" "AllocCPUS floors to 1"
make_stub sacct 'echo "5G|1"'

# --- empty sstat must not record a sample ------------------------------------
make_stub sstat 'exit 1'
drona_metrics_sample 222
assert_eq "$([[ -e "$WORK/222.tsv" ]] && echo yes || echo no)" "no" \
  "no sample recorded when sstat is empty"

# --- too little history renders the empty state, not a broken chart ----------
make_stub sstat 'echo "00:30|1048576K"'
OUT=$(JOBID=333 bash "$SCRIPTS/drona_slurm_chart.sh")
assert_contains "$OUT" "dm-empty" "single sample yields the empty state"
assert_contains "$OUT" "Collecting samples" "empty state explains why"

# --- a real series renders the component -------------------------------------
# 3 rows: 10s apart, CPU climbing 0->10s->15s of cpu-time on 1 alloc CPU.
# point1 = 10s cpu / (10s wall * 1) = 100% ; point2 = 5/10 = 50%
printf '1000\t0\t536870912\n1010\t10\t1073741824\n1020\t15\t1610612736\n' > "$WORK/444.tsv"
make_stub sstat 'exit 1'   # no new sample; assert on the fixed history
OUT=$(JOBID=444 bash "$SCRIPTS/drona_slurm_chart.sh")
assert_contains "$OUT" "<drona-chart" "emits the component element"
assert_contains "$OUT" '"points":[100.0,50.0]' "CPU% is a real rate from cpu-time deltas"
assert_contains "$OUT" '"label":"Memory"' "memory series present when ReqMem is known"
assert_contains "$OUT" '"points":[20.0,30.0]' "Mem% is rss/ReqMem (1G,1.5G of 5G)"
assert_contains "$OUT" 'x-span="20"' "x-span is the wall span of the samples"

# --- purity: retrievers must never emit executable markup --------------------
case "$OUT" in
  *"<script"*) echo "FAIL: emitted a <script> tag"; exit 1 ;;
esac
if echo "$OUT" | grep -qiE ' on[a-z]+=' ; then
  echo "FAIL: emitted an inline event handler"; exit 1
fi
echo "ok: output is pure markup (no <script>, no on* handlers)"

# --- no ReqMem -> CPU only, never a fabricated memory percentage -------------
make_stub sacct 'echo "|1"'
OUT=$(JOBID=444 bash "$SCRIPTS/drona_slurm_chart.sh")
assert_contains "$OUT" '"label":"CPU"' "CPU still plotted without ReqMem"
case "$OUT" in
  *'"label":"Memory"'*) echo "FAIL: invented a memory % with no ReqMem"; exit 1 ;;
esac
echo "ok: memory series omitted when ReqMem is unknown"

# --- history is capped -------------------------------------------------------
make_stub sacct 'echo "5G|1"'
make_stub sstat 'echo "00:30|1048576K"'
export DRONA_METRICS_MAX_SAMPLES=5
: > "$WORK/555.tsv"
for i in $(seq 1 9); do drona_metrics_sample 555 >/dev/null; done
assert_eq "$(wc -l < "$WORK/555.tsv" | tr -d ' ')" "5" "history capped at DRONA_METRICS_MAX_SAMPLES"

echo
echo "all chart tests passed"
