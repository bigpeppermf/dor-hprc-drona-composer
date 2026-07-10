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
dash() { local v="$1"; if [[ -z "$v" || "$v" == "0" || "$v" == "0K" || "$v" == "0B" || "$v" == "00:00" || "$v" == "00:00:00" ]]; then echo "—"; else echo "$v"; fi; }
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
  BODY='<div class="dm-empty">collecting first samples…</div>'
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
    <span class="dm-tile-label">MEMORY</span>
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
