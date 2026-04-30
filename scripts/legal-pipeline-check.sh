#!/usr/bin/env bash
#
# legal-pipeline-check.sh — verifies that any commit touching legal-sensitive
# files carries a `Legal-Pipeline-Verified:` trailer in its message.
#
# Why this exists: company-level rules (`~/.claude/CLAUDE.md` § legal-rf)
# require legal/Russian-jurisdiction work to flow through
# `legal-rf-router → profile skill → legal-rf-qa`. There is no automated
# proof that the pipeline ran — but every commit that mutates regulated
# text MUST leave a written record of intent. This script enforces that
# record at commit-msg time (locally) and at PR time (CI).
#
# Trailer format (free-form value, non-empty):
#   Legal-Pipeline-Verified: legal-rf-router → legal-rf-commercial → legal-rf-qa (2026-04-29)
#   Legal-Pipeline-Verified: trivial-fix — typo, no semantic change
#
# See docs/legal-pipeline.md for full policy and recommended values.
#
# Usage:
#   $0 --commit-msg <message-file>   (invoked by .githooks/commit-msg)
#   $0 --ci                          (invoked by .github/workflows/legal-pipeline.yml;
#                                     reads BASE_SHA + HEAD_SHA env vars)
#
# Exit codes:
#   0  clean (no legal files touched, or trailer present)
#   1  guardrail violation (legal files touched, trailer missing)
#   2  bad usage

set -euo pipefail

# Files that are first-class legal source of truth.
LEGAL_PATHS=(
  "app/offer/page.tsx"
  "app/privacy/page.tsx"
  "app/consent/personal-data/page.tsx"
)

# Path prefixes that are entirely legal scope.
LEGAL_PREFIXES=(
  "lib/legal/"
  "docs/legal/"
  "app/offer/"
  "app/privacy/"
  "app/consent/"
)

TRAILER_KEY="Legal-Pipeline-Verified"

matches_legal_scope() {
  local file="$1"
  local p
  for p in "${LEGAL_PATHS[@]}"; do
    [ "$file" = "$p" ] && return 0
  done
  for p in "${LEGAL_PREFIXES[@]}"; do
    case "$file" in "$p"*) return 0 ;; esac
  done
  return 1
}

has_trailer() {
  # Trailer must appear on its own line, key followed by `:`, then at least
  # one non-whitespace character. Whitespace-only or "TODO" placeholder is
  # rejected by `[^[:space:]]+`.
  local msg="$1"
  printf '%s\n' "$msg" | grep -qE "^${TRAILER_KEY}:[[:space:]]+[^[:space:]]+"
}

check_one() {
  local commit_label="$1"
  local msg="$2"
  shift 2
  local files=("$@")

  local touched_legal=()
  local f
  for f in "${files[@]}"; do
    [ -z "$f" ] && continue
    if matches_legal_scope "$f"; then
      touched_legal+=("$f")
    fi
  done

  if [ "${#touched_legal[@]}" = "0" ]; then
    return 0
  fi

  if has_trailer "$msg"; then
    return 0
  fi

  echo "[legal-pipeline] commit ${commit_label} touches legal-sensitive file(s)" >&2
  echo "[legal-pipeline] but the message has no '${TRAILER_KEY}:' trailer." >&2
  echo "[legal-pipeline] See docs/legal-pipeline.md." >&2
  echo "[legal-pipeline] Touched legal file(s):" >&2
  for f in "${touched_legal[@]}"; do
    echo "[legal-pipeline]   - $f" >&2
  done
  echo "[legal-pipeline]" >&2
  echo "[legal-pipeline] Add a trailer line to the commit message:" >&2
  echo "[legal-pipeline]   ${TRAILER_KEY}: legal-rf-router → legal-rf-<sub> → legal-rf-qa (YYYY-MM-DD)" >&2
  echo "[legal-pipeline] or, for a documented exception:" >&2
  echo "[legal-pipeline]   ${TRAILER_KEY}: trivial-fix — <reason, no semantic change>" >&2
  return 1
}

mode="${1:-}"

case "$mode" in
  --commit-msg)
    msg_file="${2:-}"
    if [ -z "$msg_file" ] || [ ! -f "$msg_file" ]; then
      echo "Usage: $0 --commit-msg <message-file>" >&2
      exit 2
    fi
    msg="$(cat "$msg_file")"
    # Files about to be committed = the staged tree at this moment.
    # `--diff-filter=ACMR` skips deletions; deletions of legal docs DO need
    # the trailer too — drop the filter.
    # Read into array via `while read` for bash 3.2 compatibility (macOS).
    files=()
    while IFS= read -r f; do files+=("$f"); done < <(git diff --cached --name-only)
    check_one "(pre-commit)" "$msg" "${files[@]-}"
    ;;

  --ci)
    base="${BASE_SHA:-}"
    head="${HEAD_SHA:-}"
    if [ -z "$base" ] || [ -z "$head" ]; then
      echo "BASE_SHA and HEAD_SHA must be set for --ci mode." >&2
      exit 2
    fi

    # Make sure we have the commits locally. GH Actions checkout with
    # fetch-depth=0 already pulls everything; this is a defensive no-op.
    git fetch --quiet origin "$base" 2>/dev/null || true

    failed=0
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      msg="$(git show -s --format=%B "$sha")"
      files=()
      while IFS= read -r f; do files+=("$f"); done < <(git show --name-only --format= "$sha")
      if ! check_one "$sha" "$msg" "${files[@]-}"; then
        failed=1
      fi
    done < <(git log --format=%H "$base..$head")

    if [ "$failed" != "0" ]; then
      exit 1
    fi
    ;;

  *)
    echo "Usage: $0 --commit-msg <message-file> | --ci" >&2
    exit 2
    ;;
esac
