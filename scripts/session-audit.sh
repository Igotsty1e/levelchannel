#!/usr/bin/env bash
#
# session-audit.sh — read-only diagnostic. Reports whether recent
# commits + team-activity entries in this repo carry the discipline
# markers a multi-PR session is supposed to leave behind:
#
#   - `Skill-Used:` trailer on every non-trivial commit (per
#     scripts/skill-pipeline-check.sh threshold).
#   - At least one `complete` entry in `~/.team/activity.jsonl` for
#     the time window.
#   - At least one `Skill-Used: /document-release` or `Skill-Used: /learn`
#     in the window (proxy for session-end discipline).
#
# Does NOT block anything. Exit code is informational. The point is
# visibility: at end-of-session you can confirm the trail is intact,
# before closing the conversation.
#
# Usage:
#   bash scripts/session-audit.sh                  # default: last 4 hours
#   bash scripts/session-audit.sh --since "2 hours ago"
#   bash scripts/session-audit.sh --since "2026-05-13 10:00"
#
# See docs/skill-pipeline.md.

set -euo pipefail

since="4 hours ago"
if [ "${1:-}" = "--since" ] && [ -n "${2:-}" ]; then
  since="$2"
fi

root="$(git rev-parse --show-toplevel)"
cd "$root"

echo "[session-audit] window: --since '${since}'"
echo "[session-audit] repo:   $(pwd)"
echo

# --- Part 1: commits in the window without Skill-Used trailer ---

shas="$(git log --since="${since}" --format=%H 2>/dev/null || true)"
total=0
non_trivial=0
missing_trailer=0
trivial_marked=0

while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  total=$((total + 1))
  subject="$(git show -s --format=%s "$sha")"
  case "$subject" in
    "Merge "*|"Revert "*|"Bump "*|"build(deps"*|"chore(deps"*)
      continue
      ;;
  esac

  # Compute watched delta same way as check script (inline minimal
  # version to keep this script self-contained).
  files_count=0
  lines_count=0
  while IFS=$'\t' read -r added removed path; do
    [ -z "$path" ] && continue
    [ "$added" = "-" ] && continue
    case "$path" in
      app/*|lib/*|tests/*|migrations/*)
        files_count=$((files_count + 1))
        lines_count=$((lines_count + added + removed))
        ;;
    esac
  done < <(git show --numstat --format= "$sha" 2>/dev/null)

  if [ "$files_count" -lt 3 ] && [ "$lines_count" -lt 100 ]; then
    continue
  fi
  non_trivial=$((non_trivial + 1))

  msg="$(git show -s --format=%B "$sha")"
  if printf '%s\n' "$msg" | grep -qE "^Skill-Used:[[:space:]]+[^[:space:]]+"; then
    if printf '%s\n' "$msg" | grep -qE "^Skill-Used:[[:space:]]+trivial"; then
      trivial_marked=$((trivial_marked + 1))
    fi
    continue
  fi
  missing_trailer=$((missing_trailer + 1))
  short="$(git show -s --format='%h %s' "$sha")"
  echo "[session-audit] MISSING Skill-Used trailer on non-trivial commit:"
  echo "  $short"
  echo "  files=$files_count lines=$lines_count"
  echo
done <<< "$shas"

echo "[session-audit] commits in window: ${total} (non-trivial: ${non_trivial}, trivial-marked: ${trivial_marked}, missing trailer: ${missing_trailer})"
echo

# --- Part 2: team-activity entries in the window ---

team_log="$HOME/.team/activity.jsonl"
if [ -f "$team_log" ]; then
  # Convert --since to epoch for grep-friendly filtering.
  since_epoch="$(date -j -f '%Y-%m-%d %H:%M:%S' "$(date -j -v"-${since// /}" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')" '+%s' 2>/dev/null || echo 0)"
  # Simple count without strict time parsing — best-effort signal.
  recent_count="$(tail -n 200 "$team_log" 2>/dev/null | wc -l | tr -d ' ')"
  complete_count="$(tail -n 200 "$team_log" 2>/dev/null | grep -c '"event":"complete"' || true)"
  echo "[session-audit] team-activity tail-200: ${recent_count} entries, ${complete_count} of type 'complete'"
  if [ "$complete_count" = "0" ]; then
    echo "[session-audit] WARN: no 'complete' entries in recent tail. Did you ~/.team/bin/log-event after shipping?"
  fi
else
  echo "[session-audit] WARN: ${team_log} not found — team-activity log missing"
fi
echo

# --- Part 3: session-end skill markers ---

doc_release_seen=0
learn_seen=0
while IFS= read -r sha; do
  [ -z "$sha" ] && continue
  msg="$(git show -s --format=%B "$sha" 2>/dev/null || true)"
  if printf '%s\n' "$msg" | grep -qE "Skill-Used:.*document-release"; then
    doc_release_seen=1
  fi
  if printf '%s\n' "$msg" | grep -qE "Skill-Used:.*\/learn"; then
    learn_seen=1
  fi
done <<< "$shas"

echo "[session-audit] session-end markers in window:"
if [ "$doc_release_seen" = "1" ]; then
  echo "  /document-release: OK"
else
  echo "  /document-release: MISSING (run before closing the session if anything shipped)"
fi
if [ "$learn_seen" = "1" ]; then
  echo "  /learn:            OK"
else
  echo "  /learn:            MISSING (run before closing the session if anything non-trivial shipped)"
fi
echo

# --- Exit code summary ---

if [ "$missing_trailer" -gt 0 ]; then
  echo "[session-audit] result: ${missing_trailer} non-trivial commit(s) without Skill-Used trailer."
  echo "[session-audit]         (informational; the CI gate already blocks merge on these)"
  exit 1
fi

echo "[session-audit] result: all non-trivial commits in window carry the trailer."
exit 0
