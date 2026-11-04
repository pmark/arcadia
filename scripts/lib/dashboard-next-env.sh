#!/usr/bin/env bash
# Sourced by scripts/dashboard-build.sh and scripts/dashboard-serve.sh, not run.
#
# A build rewrites the tracked next-env.d.ts and marks it so the checkout reads as clean. A build can be
# killed at any point, so this puts it right from git, never from a saved copy, and is safe to run at any
# time. It only acts on a file carrying that mark.
heal_next_env() {
  local repo="$1" file="apps/dashboard/next-env.d.ts" entry
  entry="$(git -C "$repo" ls-files -v -- "$file" 2>/dev/null || true)"
  [[ "$entry" == S\ * ]] || return 0
  git -C "$repo" update-index --no-skip-worktree -- "$file"
  git -C "$repo" checkout HEAD -- "$file"
}
