#!/bin/bash
# Shared time-series sampling for the job-monitoring charts. Source; don't execute.
#
# sstat reports point-in-time counters only, so a chart needs history. Each call
# to drona_metrics_sample appends one row; the panel's refreshInterval sets the
# cadence. History lives under the user's cache dir (on a cluster $HOME is a
# shared filesystem, so it survives landing on a different node).
#
# Row format (TSV):  <epoch>  <total_cpu_seconds>  <peak_rss_bytes>
#
# Derived series (both real, both 0-100, so they share one axis):
#   CPU%      = delta(total_cpu_seconds) / (delta(wall) * AllocCPUS) * 100
#   Peak mem% = peak_rss_bytes / ReqMem_bytes * 100
#
# Two field semantics worth knowing, because they are easy to get wrong:
#   * sstat's AveCPU is the average cpu-time PER TASK. Total cpu-time is
#     AveCPU * NTasks. Storing AveCPU alone and dividing by AllocCPUS
#     under-reports utilization by a factor of NTasks on multi-task jobs.
#     We normalize to total at sample time so the stored series is unambiguous.
#   * sstat's MaxRSS is a high-water mark: it never decreases. So the memory
#     series is genuinely "peak so far", not current usage, and is labelled
#     that way rather than implying live occupancy.

DRONA_METRICS_MAX_SAMPLES="${DRONA_METRICS_MAX_SAMPLES:-120}"

# Where this job's history lives.
drona_metrics_file() {
  local jobid="$1"
  local dir="${DRONA_METRICS_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/drona/metrics}"
  mkdir -p "$dir" 2>/dev/null
  echo "$dir/${jobid}.tsv"
}

# Size string (5G, 2048K) -> bytes. Mirrors to_bytes() in drona_slurm_sstat.sh.
drona_to_bytes() {
  local v="$1"; [[ -z "$v" ]] && { echo 0; return; }
  local num="${v%[KMGTkmgt]*}"; local unit="${v: -1}"
  awk -v n="$num" -v u="$unit" 'BEGIN{
    m=1; if(u=="K"||u=="k")m=1024; else if(u=="M"||u=="m")m=1048576;
    else if(u=="G"||u=="g")m=1073741824; else if(u=="T"||u=="t")m=1099511627776;
    if(n=="")n=0; printf "%.0f", n*m }'
}

# Time string (ss.mmm, mm:ss.mmm, hh:mm:ss, d-hh:mm:ss) -> whole seconds.
drona_to_secs() {
  local v="$1"; [[ -z "$v" ]] && { echo 0; return; }
  local days=0
  if [[ "$v" == *-* ]]; then days="${v%%-*}"; v="${v#*-}"; fi
  awk -v d="$days" -v t="$v" 'BEGIN{
    n=split(t,a,":"); s=0;
    if(n==3) s=a[1]*3600+a[2]*60+a[3];
    else if(n==2) s=a[1]*60+a[2];
    else s=a[1];
    printf "%d", d*86400+s }'
}

# Static denominators from accounting: "<reqmem_bytes> <alloc_cpus>".
# ReqMem/AllocCPUS only populate on the parent row, so take the first non-empty.
drona_metrics_denoms() {
  local jobid="$1"
  local raw reqmem alloc
  raw=$(sacct -j "$jobid" --format=ReqMem,AllocCPUS -n -P 2>/dev/null)
  reqmem=$(echo "$raw" | awk -F'|' '$1!=""{print $1; exit}')
  alloc=$(echo "$raw"  | awk -F'|' '$2!=""{print $2; exit}')
  [[ -z "$alloc" || "$alloc" -lt 1 ]] 2>/dev/null && alloc=1
  echo "$(drona_to_bytes "$reqmem") ${alloc:-1}"
}

# Sample sstat once and append a row. No-op if sstat returns nothing (job not
# running yet), so we never record a bogus zero sample.
drona_metrics_sample() {
  local jobid="$1"
  local file raw cpu rss ntasks total_cpu
  file="$(drona_metrics_file "$jobid")"

  raw=$(sstat -j "${jobid}.batch" --format=AveCPU,MaxRSS,NTasks -n -P 2>/dev/null | head -n1)
  [[ -z "$raw" ]] && return 1

  IFS='|' read -r cpu rss ntasks <<< "$raw"
  [[ -z "$cpu" && -z "$rss" ]] && return 1

  # AveCPU is per task -> scale to total cpu-time before storing.
  [[ -z "$ntasks" || "$ntasks" -lt 1 ]] 2>/dev/null && ntasks=1
  total_cpu=$(( $(drona_to_secs "$cpu") * ntasks ))

  printf '%s\t%s\t%s\n' "$(date +%s)" "$total_cpu" "$(drona_to_bytes "$rss")" >> "$file"

  # Cap history so a long job can't grow the file without bound.
  local lines
  lines=$(wc -l < "$file" 2>/dev/null || echo 0)
  if (( lines > DRONA_METRICS_MAX_SAMPLES )); then
    tail -n "$DRONA_METRICS_MAX_SAMPLES" "$file" > "${file}.trim" && mv "${file}.trim" "$file"
  fi
  return 0
}

# Emit "<cpu_csv>|<mem_csv>|<span_seconds>|<times_csv>" from history, or nothing
# if there is not enough history to derive a series.
#
# CPU% is a *rate*, so it needs two raw samples per plotted point; that makes the
# CPU series one shorter than the memory series. We drop memory's first sample to
# keep both aligned on the same x positions.
#
# times_csv carries each point's offset in seconds from the first raw sample.
# Sampling only advances while the panel is polling, so gaps are common (a closed
# tab, a throttled background tab). Without real timestamps the chart would space
# a 10-minute gap exactly like a 20-second one and misrepresent when things
# happened.
drona_metrics_series() {
  local jobid="$1" reqmem="$2" alloc="$3"
  local file; file="$(drona_metrics_file "$jobid")"
  [[ -s "$file" ]] || return 1

  awk -F'\t' -v reqmem="$reqmem" -v alloc="$alloc" '
    { t[NR]=$1+0; cpu[NR]=$2+0; rss[NR]=$3+0 }
    END {
      if (NR < 3) exit 1            # need >=3 rows -> >=2 rate points
      cs=""; ms=""; xs=""; k=0
      for (i=2; i<=NR; i++) {
        dw = t[i]-t[i-1]; dc = cpu[i]-cpu[i-1]
        p = (dw>0 && alloc>0) ? (100*dc)/(dw*alloc) : 0
        if (p<0) p=0; if (p>100) p=100
        m = (reqmem>0) ? (100*rss[i])/reqmem : 0
        if (m<0) m=0; if (m>100) m=100
        cs = cs (k?",":"") sprintf("%.1f", p)
        ms = ms (k?",":"") sprintf("%.1f", m)
        xs = xs (k?",":"") sprintf("%d", t[i]-t[1])
        k++
      }
      printf "%s|%s|%d|%s", cs, ms, t[NR]-t[1], xs
    }
  ' "$file"
}
