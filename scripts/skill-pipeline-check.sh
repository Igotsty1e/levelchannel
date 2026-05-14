#!/usr/bin/env bash
#
# skill-pipeline-check.sh — verifies that any commit with a non-trivial
# diff in watched trees carries a `Skill-Used:` trailer in its message.
#
# Why this exists: company-level rules (`~/.claude/COMPANY.md` §
# "GSTACK skills as primary execution layer") require non-trivial
# engineering moves to go through a GSTACK skill (/ship, /review,
# /codex, /investigate, /document-release, etc). There is no automated
# proof that the skill literally ran — but every non-trivial commit
# MUST leave a written record of which skill (or documented exception)
# covered the work. This script enforces that record at commit-msg
# time (locally) and at PR time (CI).
#
# Threshold (commit is "non-trivial" if EITHER condition holds):
#   - ≥ 3 files touched in watched trees, OR
#   - ≥ 100 lines added+removed in watched trees.
#
# Watched trees:
#   app/, lib/, tests/, migrations/
#
# Trailer format (free-form value, non-empty):
#   Skill-Used: /ship
#   Skill-Used: /codex review (round 2 LGTM)
#   Skill-Used: /investigate — flaky integration test root cause
#   Skill-Used: trivial — comment polish only
#   Skill-Used: drive-by — flaky test fix during unrelated PR
#
# See docs/skill-pipeline.md for full policy and recommended values.
#
# Usage:
#   $0 --commit-msg <message-file>   (invoked by .githooks/commit-msg)
#   $0 --ci                          (invoked by .github/workflows/skill-pipeline.yml;
#                                     reads BASE_SHA + HEAD_SHA env vars)
#
# Exit codes:
#   0  clean (diff below threshold, or trailer present)
#   1  guardrail violation (non-trivial diff, trailer missing)
#   2  bad usage

set -euo pipefail

# Trees whose changes count toward the threshold. Markdown / docs are
# intentionally NOT here — doc-only commits don't need a skill trailer.
WATCHED_TREES=(
  "app/"
  "lib/"
  "tests/"
  "migrations/"
)

# Threshold values. Tune via env vars for local experimentation.
THRESHOLD_FILES="${SKILL_PIPELINE_THRESHOLD_FILES:-3}"
THRESHOLD_LINES="${SKILL_PIPELINE_THRESHOLD_LINES:-100}"

TRAILER_KEY="Skill-Used"

# True if the file is inside one of the watched trees.
matches_watched_scope() {
  local file="$1"
  local p
  for p in "${WATCHED_TREES[@]}"; do
    case "$file" in "$p"*) return 0 ;; esac
  done
  return 1
}

# True if the commit message contains a valid trailer.
has_trailer() {
  local msg="$1"
  # Trailer must appear on its own line, key followed by `:`, then at
  # least one non-whitespace character.
  printf '%s\n' "$msg" | grep -qE "^${TRAILER_KEY}:[[:space:]]+[^[:space:]]+"
}

# True if the subject line marks this as a merge / revert / bot commit
# that should bypass the check entirely.
is_exempt_subject() {
  local subject="$1"
  case "$subject" in
    "Merge "*|"Revert "*|"Bump "*|"build(deps"*|"chore(deps"*) return 0 ;;
  esac
  return 1
}

# Counts files + line delta in watched trees for the given diff context.
# Arguments:
#   $1 — diff source ("--cached" for staged tree, or a SHA range)
# Echoes: "<files>:<lines>"
compute_watched_delta() {
  local source="$1"
  local files_count=0
  local lines_count=0

  # name-only for file count
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if matches_watched_scope "$f"; then
      files_count=$((files_count + 1))
    fi
  done < <(git diff "$source" --name-only 2>/dev/null)

  # numstat for line count: <added>\t<removed>\t<path>
  local added removed path
  while IFS=$'\t' read -r added removed path; do
    [ -z "$path" ] && continue
    # Binary files report "-" for added/removed.
    [ "$added" = "-" ] && continue
    if matches_watched_scope "$path"; then
      lines_count=$((lines_count + added + removed))
    fi
  done < <(git diff "$source" --numstat 2>/dev/null)

  printf '%s:%s\n' "$files_count" "$lines_count"
}

# Same as compute_watched_delta but for a specific SHA (vs its parent).
compute_watched_delta_for_sha() {
  local sha="$1"
  local files_count=0
  local lines_count=0

  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if matches_watched_scope "$f"; then
      files_count=$((files_count + 1))
    fi
  done < <(git show --name-only --format= "$sha" 2>/dev/null)

  local added removed path
  while IFS=$'\t' read -r added removed path; do
    [ -z "$path" ] && continue
    [ "$added" = "-" ] && continue
    if matches_watched_scope "$path"; then
      lines_count=$((lines_count + added + removed))
    fi
  done < <(git show --numstat --format= "$sha" 2>/dev/null)

  printf '%s:%s\n' "$files_count" "$lines_count"
}

# Reports threshold violation in a human-readable format.
report_violation() {
  local label="$1"
  local files="$2"
  local lines="$3"
  echo "[skill-pipeline] commit ${label} crosses the non-trivial threshold:" >&2
  echo "[skill-pipeline]   files in watched trees: ${files} (limit ${THRESHOLD_FILES})" >&2
  echo "[skill-pipeline]   lines added+removed:    ${lines} (limit ${THRESHOLD_LINES})" >&2
  echo "[skill-pipeline] but the message has no '${TRAILER_KEY}:' trailer." >&2
  echo "[skill-pipeline] See docs/skill-pipeline.md." >&2
  echo "[skill-pipeline]" >&2
  echo "[skill-pipeline] Add a trailer line to the commit message:" >&2
  echo "[skill-pipeline]   ${TRAILER_KEY}: /ship" >&2
  echo "[skill-pipeline]   ${TRAILER_KEY}: /codex review (round N)" >&2
  echo "[skill-pipeline]   ${TRAILER_KEY}: /investigate — <root cause hint>" >&2
  echo "[skill-pipeline] or, for a documented exception:" >&2
  echo "[skill-pipeline]   ${TRAILER_KEY}: trivial — <reason, no semantic change>" >&2
  echo "[skill-pipeline]   ${TRAILER_KEY}: drive-by — <unrelated wave context>" >&2
}

# Decide if a commit needs a trailer and check whether one is present.
# Arguments:
#   $1 — label for diagnostics (sha or "(pre-commit)")
#   $2 — commit message (full body)
#   $3 — files count in watched trees
#   $4 — lines delta in watched trees
check_one() {
  local label="$1"
  local msg="$2"
  local files="$3"
  local lines="$4"

  local subject
  subject="$(printf '%s\n' "$msg" | head -n 1)"

  if is_exempt_subject "$subject"; then
    return 0
  fi

  if [ "$files" -lt "$THRESHOLD_FILES" ] && [ "$lines" -lt "$THRESHOLD_LINES" ]; then
    return 0
  fi

  if has_trailer "$msg"; then
    return 0
  fi

  report_violation "$label" "$files" "$lines"
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
    delta="$(compute_watched_delta --cached)"
    files="${delta%%:*}"
    lines="${delta##*:}"
    check_one "(pre-commit)" "$msg" "$files" "$lines"
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
      delta="$(compute_watched_delta_for_sha "$sha")"
      files="${delta%%:*}"
      lines="${delta##*:}"
      if ! check_one "$sha" "$msg" "$files" "$lines"; then
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
