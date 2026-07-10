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
