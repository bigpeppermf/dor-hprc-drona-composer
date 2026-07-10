#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_slurm_seff.sh"
export DRONA_RUNTIME_DIR="$DIR/.."

make_stub seff 'printf "CPU Efficiency: 85.2%% of 1-00:00:00 core-walltime\nMemory Efficiency: 42.0%% of 4.00 GB\n"'
use_stubs
OUT=$(JOBIDS=123 bash "$SCRIPT")
assert_contains "$OUT" 'dm-tile' "seff tiles present"
assert_contains "$OUT" '85.2' "cpu efficiency present"
assert_contains "$OUT" 'dm-bar-fill' "efficiency bar present"
cleanup_stubs
echo "ALL PASS"
