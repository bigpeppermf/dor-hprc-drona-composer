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
    *)                  echo "UNKNOWN" ;;
  esac
}
