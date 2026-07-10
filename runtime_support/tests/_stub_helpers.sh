#!/bin/bash
# Test helper: create a temp dir of stub executables and prepend to PATH.
# Usage:
#   source _stub_helpers.sh
#   make_stub squeue 'echo "RUNNING"'
#   make_stub sacct  'exit 0'
#   use_stubs   # prepends stub dir to PATH
#   ... run retriever ...
#   cleanup_stubs
STUB_DIR="$(mktemp -d)"
make_stub() {
  local name="$1"; local body="$2"
  printf '#!/bin/bash\n%s\n' "$body" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}
use_stubs() { PATH="$STUB_DIR:$PATH"; }
cleanup_stubs() { rm -rf "$STUB_DIR"; }
assert_eq() {
  local got="$1"; local want="$2"; local msg="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL: $msg — got [$got] want [$want]"; exit 1
  fi
  echo "ok: $msg"
}
assert_contains() {
  local hay="$1"; local needle="$2"; local msg="$3"
  if [[ "$hay" != *"$needle"* ]]; then
    echo "FAIL: $msg — output missing [$needle]"; exit 1
  fi
  echo "ok: $msg"
}
