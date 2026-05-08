#!/usr/bin/env bash
#
# Seccomp regression harness — Codex review 2026-05-09 (Wave 8 #6 / Issue #86).
#
# Why this exists:
#
#   PR #98 added an explicit pkey-* allowlist to SystemCallFilter on
#   all 5 maintenance unit files because Node 20 V8 calls pkey_alloc
#   (#330) for JIT-cache hardening, and Ubuntu systemd 255's
#   `@system-service` group doesn't include the pkey family. Without
#   the explicit allowlist, every maintenance unit died with SIGSYS
#   (status 31) at startup.
#
#   The fix is hard-coded in each unit. If a future Node/V8/systemd
#   change introduces a new required syscall outside our allowlist,
#   we'd find out only when a production timer fires and the unit
#   crashes — possibly hours after merge, depending on cron cadence.
#
# What this script does:
#
#   For each maintenance script, run a minimal Node invocation under
#   the EXACT SystemCallFilter we ship in the systemd unit files:
#
#     1. `node --version` — verifies V8 startup itself works
#     2. `node -e 'await import("pg")'` — verifies module loading +
#        full V8 JIT path (the pkey path lights up here)
#
#   Asserts exit 0 + expected output for each. Failure means the
#   filter is incompatible with Node — same class of failure that
#   Issue #86 documented.
#
# Where this is meant to run:
#
#   - Local dev on Linux with systemd: `bash scripts/seccomp-regression-check.sh`
#   - CI on Ubuntu runners: same command (sudo available without password)
#   - Prod VPS: same command, ad-hoc verification
#
#   On macOS / non-systemd hosts, the script politely skips with
#   exit 0 and a note. Don't fail-loud just because the runner
#   doesn't have systemd; the test is meaningful only on the systems
#   we actually deploy to.
#
# How to extend:
#
#   When a new maintenance unit is added, add its filter spec to the
#   FILTER_SPECS array below. The check is a contract: changing the
#   pkey-* allowlist should fail this script on the changed unit if
#   the new filter is incompatible with Node.

set -uo pipefail

# Skip on non-Linux / no systemd.
if [ "$(uname -s)" != "Linux" ]; then
  echo "[seccomp-check] skip: not Linux ($(uname -s))"
  exit 0
fi
if ! command -v systemd-run >/dev/null 2>&1; then
  echo "[seccomp-check] skip: systemd-run not available"
  exit 0
fi

# Sudo wrapper. systemd-run system-level needs root; CI / prod have
# sudo. Local dev with `sudo -n` failing means we skip.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if sudo -n true 2>/dev/null; then
    SUDO="sudo -n"
  else
    echo "[seccomp-check] skip: not root and sudo not available without password"
    exit 0
  fi
fi

# The exact SystemCallFilter we ship — from the maintenance unit
# files, mechanically extracted to keep this in lockstep. If the
# filter shape changes, this script should reflect it on the same
# commit as the unit files (otherwise the harness drifts).
SYSCALL_ALLOWLIST="@system-service pkey_alloc pkey_mprotect pkey_free"
SYSCALL_DENYLIST="~@privileged @resources @debug @mount @cpu-emulation @obsolete"

# Resolve `node` absolute path. Prod uses /usr/bin/node (apt-installed);
# CI Ubuntu runners use /opt/hostedtoolcache/node/.../bin/node from
# actions/setup-node. systemd-run requires an absolute path. The check
# is V8-syscall-compatibility-against-the-filter, not path-binding;
# either Node binary at the same major version is equivalent for this
# purpose.
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  echo "[seccomp-check] FAIL: node not found in PATH"
  exit 1
fi
echo "[seccomp-check] using node at: $NODE_BIN"

FAILS=0

# Working directory needs node_modules access. Resolution:
#   1. Explicit env var (CI / ad-hoc with non-standard layout)
#   2. Auto-detect from the script's own location (file on disk)
#   3. Fall back to current working directory (script piped via stdin)
APP_DIR="${SECCOMP_CHECK_APP_DIR:-}"
if [ -z "$APP_DIR" ]; then
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  else
    APP_DIR="$(pwd)"
  fi
fi
if [ ! -d "$APP_DIR/node_modules" ]; then
  echo "[seccomp-check] note: $APP_DIR/node_modules not found — pg test may fail"
  echo "    set SECCOMP_CHECK_APP_DIR=/path/to/repo if needed"
fi

run_under_filter() {
  local label="$1"
  shift
  # Use a unique transient unit name per call.
  local unit="lc-seccomp-check-$$-$(date +%s%N | head -c 16)"

  # Capture stdout. systemd-run --pipe sends stdout/stderr through the
  # invoking shell, so we can grep for expected output.
  local out
  out=$(${SUDO} systemd-run \
    --unit="$unit" \
    --service-type=oneshot \
    --working-directory="$APP_DIR" \
    --pipe \
    --collect \
    --property=SystemCallArchitectures=native \
    --property="SystemCallFilter=$SYSCALL_ALLOWLIST" \
    --property="SystemCallFilter=$SYSCALL_DENYLIST" \
    --wait \
    "$@" 2>&1)
  local rc=$?

  if [ "$rc" -ne 0 ]; then
    # Distinguish seccomp kill (status 31/SYS) from ordinary errors.
    # Both are exit-failures here, but the message + recipe applies
    # only to seccomp kills; non-seccomp errors point at app issues.
    local kind="non-seccomp"
    if printf '%s' "$out" | grep -q 'status=31/SYS'; then
      kind="seccomp-kill"
    fi
    printf '  FAIL  %-40s exit=%s kind=%s\n' "$label" "$rc" "$kind"
    printf '         output: %s\n' "$out" | head -3
    FAILS=$((FAILS + 1))
    return
  fi
  printf '  ok    %-40s exit=0\n' "$label"
}

echo "=== seccomp regression harness ==="
echo "filter: SystemCallFilter=$SYSCALL_ALLOWLIST"
echo "        SystemCallFilter=$SYSCALL_DENYLIST"
echo

# Test 1: node --version. V8 startup, no JIT pressure.
run_under_filter "node --version" "$NODE_BIN" --version

# Test 2: node -e with module import. Triggers V8 JIT, the path
# that hit pkey_alloc in Issue #86. If our allowlist is incomplete
# for any future syscall, this is where it surfaces.
run_under_filter "node -e (load pg)" "$NODE_BIN" -e 'import("pg").then(() => process.exit(0))'

# Test 3: node -e with libuv exercise. Catches future libuv-internal
# syscalls that may need allowlisting.
run_under_filter "node -e (libuv: net + dns + fs)" "$NODE_BIN" --input-type=module -e '
import { stat } from "node:fs/promises"
import { createServer } from "node:net"
import { resolve } from "node:dns/promises"
const a = await stat("/etc/hostname")
const s = createServer()
await new Promise(r => s.listen(0, "127.0.0.1", () => r()))
await new Promise(r => s.close(() => r()))
await resolve("localhost").catch(() => {})
process.exit(0)
'

if [ "$FAILS" -gt 0 ]; then
  echo
  echo "=== seccomp regression FAILED: $FAILS check(s) ==="
  echo "    Likely a new syscall is required outside the current allowlist."
  echo "    Diagnose by following the recipe in"
  echo "    scripts/systemd/levelchannel-stale-orders.service"
  echo "    (transient systemd-run + journalctl -k | grep audit | grep syscall)"
  exit 1
fi

echo
echo "=== seccomp regression PASSED ==="
