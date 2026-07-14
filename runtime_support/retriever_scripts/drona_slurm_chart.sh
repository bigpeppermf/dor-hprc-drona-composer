#!/bin/bash
# Renders the utilization time-series chart for $JOBID.
#
# Emits declarative markup only (no <script>, no on* handlers) for the
# <drona-chart> component registered in main.bundle.js. Each invocation also
# appends one sample, so the series grows at the panel's refreshInterval.
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$DIR/drona_slurm_metrics_lib.sh" ]]; then
  source "$DIR/drona_slurm_metrics_lib.sh"
else
  # The lib is a sibling in runtime_support; fall back if this script was
  # shadow-copied into an env dir without it.
  source "$DRONA_RUNTIME_DIR/retriever_scripts/drona_slurm_metrics_lib.sh"
fi

drona_metrics_sample "$JOBID"

read -r REQMEM_BYTES ALLOC_CPUS <<< "$(drona_metrics_denoms "$JOBID")"
SERIES="$(drona_metrics_series "$JOBID" "$REQMEM_BYTES" "$ALLOC_CPUS")"

if [[ -z "$SERIES" ]]; then
  echo '<div class="dm-empty">Collecting samples… the chart appears once there are at least two.</div>'
  exit 0
fi

IFS='|' read -r CPU_CSV MEM_CSV SPAN <<< "$SERIES"

# Memory needs a real denominator; without ReqMem the percentage would be a lie,
# so plot CPU alone rather than show a fabricated memory line.
if [[ "${REQMEM_BYTES:-0}" -gt 0 ]]; then
  SERIES_JSON="[{\"label\":\"CPU\",\"color\":\"#3b82f6\",\"points\":[${CPU_CSV}]},{\"label\":\"Memory\",\"color\":\"#10b981\",\"points\":[${MEM_CSV}]}]"
else
  SERIES_JSON="[{\"label\":\"CPU\",\"color\":\"#3b82f6\",\"points\":[${CPU_CSV}]}]"
fi

printf '<drona-chart chart-title="Utilization over time" x-span="%s" series=\x27%s\x27></drona-chart>\n' \
  "$SPAN" "$SERIES_JSON"
