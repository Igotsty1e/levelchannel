#!/usr/bin/env bash

set -euo pipefail

MODE="tracked"
if [ "${1:-}" = "--staged" ]; then
  MODE="staged"
elif [ -n "${1:-}" ]; then
  echo "usage: $0 [--staged]" >&2
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

blocked_path_re='^docs/private/|(^|/)[^/]+\.private\.[^/]+$'
blocked_env_path_re='(^|/)\.env($|\.((development|production|test|local)(\..+)?)$)'

blocked_patterns=(
  '83\.217\.202\.136|production VPS IP address'
  'levelchannel_timeweb_ed25519|operator SSH key path'
  '/etc/levelchannel\.env|production env file path'
  '/usr/local/bin/levelchannel-autodeploy|production autodeploy path'
  '/var/www/levelchannel|production working directory'
  '/home/levelchannel/.ssh/github_deploy|deploy SSH key path'
  '/var/backups/levelchannel|backup directory path'
)

list_files() {
  if [ "$MODE" = "staged" ]; then
    git diff --cached --name-only --diff-filter=ACMR
  else
    git ls-files
  fi
}

read_file() {
  local path="$1"
  if [ "$MODE" = "staged" ]; then
    git show ":$path" 2>/dev/null || return 1
  else
    cat "$path" 2>/dev/null || return 1
  fi
}

failures=()

while IFS= read -r path; do
  [ -n "$path" ] || continue

  if [[ "$path" =~ $blocked_path_re ]]; then
    failures+=("blocked path: $path")
    continue
  fi

  if [[ "$path" =~ $blocked_env_path_re ]] && [[ "$path" != ".env.example" ]]; then
    failures+=("blocked path: $path")
    continue
  fi

  if [ "$path" = "scripts/public-surface-check.sh" ]; then
    continue
  fi

  if ! content="$(read_file "$path")"; then
    continue
  fi

  for rule in "${blocked_patterns[@]}"; do
    pattern="${rule%%|*}"
    reason="${rule#*|}"
    if printf '%s' "$content" | LC_ALL=C grep -nE "$pattern" >/tmp/public-surface-check.$$ 2>/dev/null; then
      first_hit="$(head -n 1 /tmp/public-surface-check.$$)"
      failures+=("$path: $reason ($first_hit)")
    fi
  done
done < <(list_files)

rm -f /tmp/public-surface-check.$$ 2>/dev/null || true

if [ "${#failures[@]}" -gt 0 ]; then
  echo "public-surface-check failed:" >&2
  printf '  - %s\n' "${failures[@]}" >&2
  echo >&2
  echo "Move private runbooks out of tracked files and replace concrete prod paths with placeholders." >&2
  exit 1
fi

echo "public-surface-check passed (${MODE})"
