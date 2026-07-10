#!/bin/bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/_stub_helpers.sh"
for f in slurm-logs-template.html slurm_cgroups_template.html; do
  C=$(cat "$DIR/../html_templates/$f")
  assert_contains "$C" 'drona-monitor' "$f wrapped in drona-monitor"
  assert_contains "$C" 'dm-card' "$f uses shared card"
  if [[ "$C" == *"<style"* ]]; then echo "FAIL: $f still has its own <style>"; exit 1; fi
  echo "ok: $f has no local <style>"
done
echo "ALL PASS"
