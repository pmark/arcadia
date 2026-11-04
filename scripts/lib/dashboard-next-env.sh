#!/usr/bin/env bash
# Sourced by scripts/dashboard-build.sh and scripts/dashboard-serve.sh, not run.
#
# A build rewrites the tracked next-env.d.ts and marks it so the checkout reads as clean. A build can be
# killed at any point, so this puts it right from git, never from a saved copy. It only acts on a file
# carrying that mark. It never fails: git can be busy, and that must not stop the dashboard starting.
# The mark stays when it can't finish, so the next start or build tries again.
heal_next_env() {
  local repo="$1" file="apps/dashboard/next-env.d.ts" entry
  entry="$(git -C "$repo" ls-files -v -- "$file" 2>/dev/null || true)"
  [[ "$entry" == S\ * ]] || return 0
  if git -C "$repo" checkout-index --force --ignore-skip-worktree-bits -- "$file" 2>/dev/null &&
    git -C "$repo" update-index --no-skip-worktree -- "$file" 2>/dev/null; then
    return 0
  fi
  echo "Could not restore $file yet. The next start or build tries again." >&2
  return 0
}
