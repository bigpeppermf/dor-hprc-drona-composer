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
