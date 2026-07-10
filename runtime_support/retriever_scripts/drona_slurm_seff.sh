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
