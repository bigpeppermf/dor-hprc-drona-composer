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
