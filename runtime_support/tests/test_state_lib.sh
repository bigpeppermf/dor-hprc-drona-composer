#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
LIB="$DIR/../retriever_scripts/drona_slurm_state_lib.sh"

# Active job: squeue returns RUNNING
make_stub squeue 'echo "RUNNING"'; make_stub sacct 'exit 0'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "RUNNING" "active RUNNING via squeue"
cleanup_stubs

# Finished job: squeue empty, sacct FAILED
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "FAILED"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "FAILED" "terminal FAILED via sacct"
cleanup_stubs

# OOM normalization (sacct long form)
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "OUT_OF_MEMORY"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "OUT_OF_MEMORY" "OOM normalized"
cleanup_stubs

# CANCELLED with trailing text (e.g. "CANCELLED by 0")
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'echo "CANCELLED by 0"'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "CANCELLED" "CANCELLED by trimmed"
cleanup_stubs

# Nothing anywhere -> UNKNOWN
source "$DIR/_stub_helpers.sh"
make_stub squeue 'exit 0'; make_stub sacct 'exit 0'; use_stubs
source "$LIB"; assert_eq "$(drona_detect_state 123)" "UNKNOWN" "no data -> UNKNOWN"
cleanup_stubs
echo "ALL PASS"
