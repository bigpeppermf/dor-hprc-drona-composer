#!/bin/bash
# Emits the normalized Slurm state token for $JOBID (used by the hidden
# `status` field that drives section conditions).
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/drona_slurm_state_lib.sh"
drona_detect_state "$JOBID"
