#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_sstat.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

# Case 1: sstat returns data
make_stub sstat 'echo "2048K|1024K|3.4G|00:40|00:12|500M|340M|4|12|8|2.4GHz"'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'dm-grid' "tile grid present"
assert_contains "$OUT" 'dm-tile' "tiles present"
assert_contains "$OUT" 'MEMORY' "memory tile label"
cleanup_stubs

# Case 2: sstat returns nothing -> empty state, not a wall of zeros
source "$DIR/_stub_helpers.sh"
make_stub sstat 'exit 0'
use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_contains "$OUT" 'collecting first samples' "empty state shown"
cleanup_stubs
echo "ALL PASS"
