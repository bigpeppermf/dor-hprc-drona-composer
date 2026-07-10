#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
SCRIPT="$DIR/../retriever_scripts/drona_info_slurmstatus.sh"

make_stub squeue 'exit 0'; make_stub sacct 'echo "COMPLETED"'; use_stubs
OUT=$(JOBID=123 bash "$SCRIPT")
assert_eq "$OUT" "COMPLETED" "terminal COMPLETED emitted as bare token"
cleanup_stubs
echo "ALL PASS"
