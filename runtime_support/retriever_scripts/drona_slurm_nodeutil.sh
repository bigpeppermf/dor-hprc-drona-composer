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
