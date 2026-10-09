#!/usr/bin/env bash
#
# Stable demo deployment (Issue #1116): a tag-driven, gated release of the
# dashboard that serves a demo on a fixed port, always reading the live
# martianrover workspace, and never changes underneath a viewer.
#
#   scripts/release.sh list
#   scripts/release.sh status
#   scripts/release.sh build <tag>
#   scripts/release.sh deploy <tag>
#   scripts/release.sh use <tag>
#   scripts/release.sh nightly
#   scripts/release.sh prune
#   scripts/release.sh install-plan
#
# Layout (ARCADIA_RELEASES_DIR):
#   <tag>/            a detached git worktree of the release tag, built in place
#   <tag>/.release-ok marker written only after install + build + next build
#   current           symlink to the serving <tag>; the demo LaunchAgent runs
#                     `next start` from current/apps/dashboard
#   receipts.jsonl    one JSON line per deploy, use, nightly and prune
#   logs/             build and staging logs
#
# `deploy` smoke-tests the candidate on a staging port first and swaps `current`
# only when every key page answers HTTP 200 within the budget, so any failure
# leaves the serving release untouched. `use` is the instant failover to a tag
# that is already built.
#
# This script never installs or loads a LaunchAgent and never runs
# `tailscale serve`: `install-plan` prints exactly what an operator would run.
# Installing is a deployment and needs an operator Decision. It does not touch
# scripts/services.sh's services (the :3020 development dashboard).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# The primary checkout: the git common dir of the checkout this script lives in,
# so the script behaves the same when run from a linked worktree.
resolve_primary_repo() {
  local common
  common="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || return 1
  if [[ "$(basename "$common")" == ".git" ]]; then dirname "$common"; else printf '%s' "$common"; fi
}

REPO="${ARCADIA_RELEASE_REPO:-$(resolve_primary_repo || true)}"
RELEASES="${ARCADIA_RELEASES_DIR:-/Users/pmark/Dev/MR/Arcadia/releases}"
DEMO_PORT="${ARCADIA_DEMO_PORT:-3030}"
STAGING_PORT="${ARCADIA_DEMO_STAGING_PORT:-3031}"
LABEL="${ARCADIA_DEMO_LABEL:-com.arcadia.demo.dashboard}"
NIGHTLY_LABEL="${ARCADIA_DEMO_NIGHTLY_LABEL:-com.arcadia.demo.nightly}"
WORKSPACE="${ARCADIA_WORKSPACE:-/Users/pmark/Dev/MR/Arcadia/workspaces/martianrover}"
# The four pages plus the snapshot API: the pages are client-rendered shells that
# answer 200 even when the release's built CLI cannot open the workspace.
SMOKE_PATHS="${ARCADIA_DEMO_SMOKE_PATHS:-/now /actions /review /projects /api/snapshot}"
SMOKE_BUDGET="${ARCADIA_DEMO_SMOKE_BUDGET:-90}"       # seconds, all pages together
SMOKE_INTERVAL="${ARCADIA_DEMO_SMOKE_INTERVAL:-2}"    # seconds between probes
HEALTH_BUDGET="${ARCADIA_DEMO_HEALTH_BUDGET:-60}"     # seconds for :3030 after a swap
STOP_GRACE="${ARCADIA_DEMO_STOP_GRACE:-5}"            # seconds the staging server gets to exit before SIGKILL
KEEP_BUILDS="${ARCADIA_RELEASE_KEEP:-3}"
TAG_PATTERN='^(v[0-9]|rel-|release-)'

CURRENT="$RELEASES/current"
RECEIPTS="$RELEASES/receipts.jsonl"
LOCK_DIR="$RELEASES/.lock"
PIN_FILE="$RELEASES/.pinned" # written by `use`; pauses nightly until the next `deploy`
LOG_DIR="$RELEASES/logs"

# mise refuses configs it has not been told to trust, and every release is a
# new path. Trusting the releases directory by environment (rather than
# `mise trust`) keeps the trust out of mise's persistent state.
export MISE_TRUSTED_CONFIG_PATHS="$RELEASES${MISE_TRUSTED_CONFIG_PATHS:+:$MISE_TRUSTED_CONFIG_PATHS}"

CMD_NAME="${1:-}"
STAGING_PID=""
LOCK_HELD=0
FAIL_REASON=""

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "$*"; exit "${2:-1}"; }

usage() {
  cat >&2 <<'USAGE'
usage: scripts/release.sh <command> [tag]

  list                 built releases and available release tags
  status               which tag is serving, whether the demo port answers, last receipt
  build <tag>          check the tag out into its own worktree and build it
  deploy <tag>         build if needed, smoke-test on the staging port, then swap and restart
  use <tag>            instant failover to an already-built tag
  nightly              fetch tags and deploy the newest release tag if it is not current
  prune                keep the newest built releases plus current; remove the rest
  install-plan         print (never run) the LaunchAgent and Tailscale install commands

Release tags match ^(v[0-9]|rel-|release-) (case-insensitive).
USAGE
  exit 2
}

need_repo() {
  [[ -n "$REPO" && -d "$REPO" ]] || die "Cannot resolve the primary repository; set ARCADIA_RELEASE_REPO." 2
}

for numeric in STOP_GRACE SMOKE_BUDGET SMOKE_INTERVAL HEALTH_BUDGET KEEP_BUILDS DEMO_PORT STAGING_PORT; do
  [[ "${!numeric}" =~ ^[0-9]+$ ]] || die "$numeric must be a non-negative integer, got: ${!numeric}" 2
done

# --- small helpers ------------------------------------------------------------

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

json_escape() { printf '%s' "$1" | tr '\n\t' '  ' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# sed rather than ${s//&/...}: bash 5.2 reads an unquoted & in a replacement as
# "the matched text", and bash 3.2 keeps quotes put around it.
xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

# receipt <outcome> <tag> <reason> [previous] [current]
receipt() {
  local outcome="$1" tag="$2" reason="$3" previous="${4:-}" now_current="${5:-}" sha=""
  if [[ -n "$tag" && -n "$REPO" ]]; then
    sha="$(git -C "$REPO" rev-parse --verify --quiet "refs/tags/$tag^{commit}" 2>/dev/null || true)"
  fi
  mkdir -p "$RELEASES"
  printf '{"ts":"%s","command":"%s","tag":"%s","sha":"%s","outcome":"%s","reason":"%s","previous":"%s","current":"%s"}\n' \
    "$(now_iso)" "$(json_escape "$CMD_NAME")" "$(json_escape "$tag")" "$sha" "$(json_escape "$outcome")" \
    "$(json_escape "$reason")" "$(json_escape "$previous")" "$(json_escape "$now_current")" >> "$RECEIPTS"
}

current_tag() {
  if [[ -L "$CURRENT" ]]; then basename "$(readlink "$CURRENT")"; fi
}

TAG_ALPHABET='^[A-Za-z0-9._+-]+$'

# Release tags newest first. Tags outside the safe alphabet (for example
# rel-a/b) are skipped here, so no consumer can pick one as a directory name.
release_tags() {
  git -C "$REPO" for-each-ref --sort=-creatordate --format='%(refname:short)' refs/tags \
    | grep -iE "$TAG_PATTERN" | grep -E "$TAG_ALPHABET" || true
}

# A tag becomes a directory name and a command argument, so it is held to a
# conservative alphabet as well as the release pattern.
check_tag_name() {
  local tag="$1"
  [[ -n "$tag" ]] || usage
  if [[ ! "$tag" =~ $TAG_ALPHABET ]] || ! printf '%s\n' "$tag" | grep -qiE "$TAG_PATTERN"; then
    die "Not a release tag: $tag (must match $TAG_PATTERN, letters, digits and . _ + - only)" 2
  fi
}

check_tag_exists() {
  git -C "$REPO" rev-parse --verify --quiet "refs/tags/$1^{commit}" >/dev/null \
    || die "No such tag in $REPO: $1 (try: git fetch --tags)" 2
}

is_built() { [[ -f "$RELEASES/$1/.release-ok" ]]; }

tag_sha() { git -C "$REPO" rev-parse --verify --quiet "refs/tags/$1^{commit}" 2>/dev/null || true; }
built_sha() { sed -n 's/^sha=//p' "$RELEASES/$1/.release-ok" 2>/dev/null | head -n 1; }

# A tag that was force-moved after its build no longer names the built commit.
# A tag that has since been deleted cannot be compared, so it counts as matching.
built_matches_tag() {
  local now
  now="$(tag_sha "$1")"
  [[ -z "$now" || "$now" == "$(built_sha "$1")" ]]
}

# Tags are cut from green main (Decision 0095): refuse anything that is not an
# ancestor of the main ref, or when the ref cannot be read to prove it.
MAIN_REF="${ARCADIA_RELEASE_MAIN_REF:-origin/main}"
tag_on_main() {
  git -C "$REPO" rev-parse --verify --quiet "$MAIN_REF^{commit}" >/dev/null 2>&1 || return 2
  git -C "$REPO" merge-base --is-ancestor "refs/tags/$1" "$MAIN_REF" 2>/dev/null
}

http_code() { # url [max-seconds]
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "${2:-10}" "$1" 2>/dev/null || true)"
  printf '%s' "${code:-000}"
}

pid_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

kill_tree() { # pid [signal]
  local pid="$1" sig="${2:-TERM}" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child" "$sig"; done
  kill "-$sig" "$pid" 2>/dev/null || true
}

# --- lock and cleanup ---------------------------------------------------------

cleanup() {
  stop_staging
  if [[ "$LOCK_HELD" -eq 1 ]]; then rm -rf "$LOCK_DIR"; LOCK_HELD=0; fi
}

# acquire_lock: returns 3 with FAIL_REASON set when another operation holds it.
acquire_lock() {
  mkdir -p "$RELEASES"
  trap cleanup EXIT
  trap 'cleanup; exit 130' INT TERM
  local attempt holder
  for attempt in 1 2; do
    if mkdir "$LOCK_DIR" 2>/dev/null; then
      printf '%s\n' "$$" > "$LOCK_DIR/pid"
      LOCK_HELD=1
      return 0
    fi
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if pid_alive "$holder"; then
      FAIL_REASON="another release operation is running (pid $holder); try again when it finishes"
      return 3
    fi
    rm -rf "$LOCK_DIR" # stale: its owner is gone
  done
  FAIL_REASON="could not take the release lock at $LOCK_DIR"
  return 3
}

lock_or_die() { acquire_lock || die "$FAIL_REASON" 3; }

# --- toolchain ----------------------------------------------------------------
# Resolved like restart-arcadia-services' restart-services.sh: mise pins the Node
# that matches each release's own mise.toml, so a release never runs on whatever
# Node a login shell happens to select.

resolve_mise() {
  local configured="${ARCADIA_MISE_BIN:-}" candidate
  if [[ -n "$configured" ]]; then
    if [[ "$configured" == */* ]]; then printf '%s' "$configured"; else command -v "$configured" || true; fi
    return 0
  fi
  for candidate in "$(command -v mise 2>/dev/null || true)" /opt/homebrew/bin/mise /usr/local/bin/mise "$HOME/.local/bin/mise"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then printf '%s' "$candidate"; return 0; fi
  done
}

# rt <release-dir> <workdir> <command...>: run under the release's pinned toolchain.
rt() {
  local reldir="$1" workdir="$2" mise
  shift 2
  if [[ -f "$reldir/mise.toml" ]]; then
    mise="$(resolve_mise)"
    [[ -n "$mise" && -x "$mise" ]] || { warn "mise is required for $reldir/mise.toml but was not found (set ARCADIA_MISE_BIN)."; return 1; }
    (cd "$workdir" && "$mise" -C "$workdir" exec -- "$@")
  else
    (cd "$workdir" && "$@")
  fi
}

# --- build --------------------------------------------------------------------

build_steps() { # tag dir
  local tag="$1" dir="$2" app="$2/apps/dashboard"
  STEP="worktree"
  # --force tolerates a stale registration of this exact path. There is no
  # repo-wide `worktree prune`: it would also drop other people's worktrees.
  git -C "$REPO" worktree add --force --detach "$dir" "refs/tags/$tag" || return 1
  STEP="install"
  rt "$dir" "$dir" pnpm install --frozen-lockfile --prefer-offline || return 1
  STEP="pnpm build"
  rt "$dir" "$dir" pnpm build || return 1
  STEP="next build"
  rt "$dir" "$app" pnpm exec next build || return 1
  STEP="verify"
  [[ -f "$dir/dist/src/cli.js" ]] || { echo "missing $dir/dist/src/cli.js"; return 1; }
  [[ -f "$app/.next/BUILD_ID" ]] || { echo "missing $app/.next/BUILD_ID"; return 1; }
  [[ -f "$app/node_modules/next/dist/bin/next" ]] || { echo "missing next in $app/node_modules"; return 1; }
  return 0
}

# build_release <tag>: sets FAIL_REASON and returns 1 on failure.
build_release() {
  local tag="$1" dir="$RELEASES/$tag" log="$RELEASES/logs/build-$1.log" sha
  if is_built "$tag" && built_matches_tag "$tag"; then say "$tag is already built."; return 0; fi
  mkdir -p "$LOG_DIR"
  : > "$log"
  if [[ -e "$dir" ]]; then
    if [[ "$(current_tag)" == "$tag" ]]; then
      FAIL_REASON="$tag is serving but $(is_built "$tag" && echo "the tag moved since it was built ($(built_sha "$tag" | cut -c1-9) -> $(tag_sha "$tag" | cut -c1-9))" || echo "it has no build marker"); refusing to rebuild it in place"
      return 1
    fi
    # A half-built attempt, or a tag that moved after its build. Reclaim only a
    # registered worktree.
    git -C "$REPO" worktree remove --force "$dir" >>"$log" 2>&1 \
      || { FAIL_REASON="$dir exists and is not a removable worktree; remove it by hand"; return 1; }
  fi
  say "Building $tag in $dir (log: $log)"
  STEP=""
  if ! build_steps "$tag" "$dir" >>"$log" 2>&1; then
    warn "Build of $tag failed at step '$STEP'. Last lines of $log:"
    tail -n 25 "$log" >&2 || true
    git -C "$REPO" worktree remove --force "$dir" >>"$log" 2>&1 || true
    FAIL_REASON="build failed at step '$STEP' (log: $log)"
    return 1
  fi
  sha="$(git -C "$REPO" rev-parse "refs/tags/$tag^{commit}")"
  printf 'tag=%s\nsha=%s\nbuilt_at=%s\n' "$tag" "$sha" "$(now_iso)" > "$dir/.release-ok"
  say "Built $tag ($sha)."
}

# --- staging smoke test -------------------------------------------------------

start_staging() { # dir
  local app="$1/apps/dashboard" next log mise
  next="$app/node_modules/next/dist/bin/next"
  log="$LOG_DIR/staging-$(basename "$1").log"
  mkdir -p "$LOG_DIR"
  [[ -f "$next" ]] || { FAIL_REASON="next is missing from $app/node_modules"; return 1; }
  if command -v lsof >/dev/null 2>&1 && [[ -n "$(lsof -nP -t -iTCP:"$STAGING_PORT" -sTCP:LISTEN 2>/dev/null || true)" ]]; then
    FAIL_REASON="staging port $STAGING_PORT is already in use"
    return 1
  fi
  mise=""
  if [[ -f "$1/mise.toml" ]]; then
    mise="$(resolve_mise)"
    [[ -n "$mise" && -x "$mise" ]] || { FAIL_REASON="mise is required but was not found"; return 1; }
  fi
  (
    cd "$app"
    export ARCADIA_WORKSPACE="$WORKSPACE" ARCADIA_DASHBOARD_CLI=built
    export ARCADIA_DASHBOARD_BASE_URL="http://127.0.0.1:$STAGING_PORT"
    if [[ -n "$mise" ]]; then
      exec "$mise" -C "$app" exec -- node "$next" start -H 127.0.0.1 -p "$STAGING_PORT"
    fi
    exec node "$next" start -H 127.0.0.1 -p "$STAGING_PORT"
  ) >"$log" 2>&1 &
  STAGING_PID=$!
}

stop_staging() {
  if [[ -n "$STAGING_PID" ]]; then
    local ticks=0
    kill_tree "$STAGING_PID"
    # Give it a bounded grace period to exit on SIGTERM, then force it, so a
    # server that ignores SIGTERM can neither hang us in `wait` nor keep :3031.
    while pid_alive "$STAGING_PID" && [[ "$ticks" -lt $(( STOP_GRACE * 10 )) ]]; do
      sleep 0.1
      ticks=$((ticks + 1))
    done
    if pid_alive "$STAGING_PID"; then kill_tree "$STAGING_PID" KILL; fi
    wait "$STAGING_PID" 2>/dev/null || true
    STAGING_PID=""
  fi
}

# smoke <port> [watched-pid]: every page must answer 200 within the shared budget.
smoke() {
  local port="$1" watched="${2:-}" deadline path code remaining
  deadline=$(( $(date +%s) + SMOKE_BUDGET ))
  for path in $SMOKE_PATHS; do
    while :; do
      remaining=$(( deadline - $(date +%s) ))
      [[ "$remaining" -ge 1 ]] || remaining=1
      code="$(http_code "http://127.0.0.1:$port$path" $(( remaining > 30 ? 30 : remaining )))"
      [[ "$code" == "200" ]] && break
      if [[ -n "$watched" ]] && ! pid_alive "$watched"; then
        FAIL_REASON="staging server exited before $path answered"
        return 1
      fi
      if [[ "$(date +%s)" -ge "$deadline" ]]; then
        FAIL_REASON="smoke check failed: $path returned HTTP $code within ${SMOKE_BUDGET}s"
        return 1
      fi
      sleep "$SMOKE_INTERVAL"
    done
    say "  smoke $path: 200"
  done
}

# --- swap and restart ---------------------------------------------------------

swap_current() { # tag
  local tmp="$RELEASES/.current.$$"
  if [[ -e "$CURRENT" && ! -L "$CURRENT" ]]; then die "$CURRENT exists and is not a symlink; refusing to replace it." 2; fi
  ln -sfn "$1" "$tmp" || return 1
  # /bin/mv, not whatever mv is first on PATH; -h / -T rename over the symlink
  # itself instead of moving into the directory it points at.
  if [[ "$(uname -s)" == "Darwin" ]]; then /bin/mv -fh "$tmp" "$CURRENT"; else /bin/mv -fT "$tmp" "$CURRENT"; fi || return 1
}

agent_loaded() { launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; }

PLIST_FILE="${ARCADIA_DEMO_PLIST:-$HOME/Library/LaunchAgents/$LABEL.plist}"
RESTART_STATE=""
RESTART_ERROR=""
restart_demo() {
  RESTART_ERROR=""
  if agent_loaded; then
    if ! launchctl kickstart -k "gui/$(id -u)/$LABEL"; then
      RESTART_ERROR="launchctl kickstart of $LABEL failed"
      return 1
    fi
    RESTART_STATE="restarted"
  elif [[ -e "$PLIST_FILE" ]]; then
    # Installed but not loaded is a broken demo, not a pre-install state.
    RESTART_ERROR="$PLIST_FILE exists but $LABEL is not loaded in launchd (launchctl bootstrap it)"
    return 1
  else
    warn "LaunchAgent $LABEL is not installed; the symlink moved but nothing was restarted. See: scripts/release.sh install-plan"
    RESTART_STATE="skipped-not-installed"
  fi
}

# serving <tag>: the demo answers for THIS release. The static manifest URL
# carries the release's own build id, so the outgoing process cannot satisfy it.
serving() {
  local tag="$1" build_id
  build_id="$(cat "$RELEASES/$tag/apps/dashboard/.next/BUILD_ID" 2>/dev/null || true)"
  [[ -n "$build_id" ]] || return 1
  [[ "$(http_code "http://127.0.0.1:$DEMO_PORT/_next/static/$build_id/_buildManifest.js" 10)" == "200" ]] || return 1
  [[ "$(http_code "http://127.0.0.1:$DEMO_PORT/now" 10)" == "200" ]] || return 1
  [[ "$(http_code "http://127.0.0.1:$DEMO_PORT/api/snapshot" 30)" == "200" ]]
}

wait_serving() { # tag
  local deadline
  deadline=$(( $(date +%s) + HEALTH_BUDGET ))
  until serving "$1"; do
    [[ "$(date +%s)" -lt "$deadline" ]] || return 1
    sleep "$SMOKE_INTERVAL"
  done
}

restore_previous() { # previous-tag
  if [[ -n "$1" ]]; then swap_current "$1"; else rm -f "$CURRENT"; fi
}

# After a rollback, restart and confirm the restored release really serves.
rollback_note() { # previous-tag
  if [[ -z "$1" ]]; then echo "no previous release to restore"; return; fi
  restart_demo || true
  if [[ "$RESTART_STATE" != "restarted" ]] || wait_serving "$1"; then
    echo "restored $1"
  else
    echo "restored $1 but it is NOT answering on :$DEMO_PORT either; run: scripts/release.sh status"
  fi
}

# activate <tag>: swap `current`, restart the demo agent, and verify it serves.
# Any failure puts the previous release back (and checks it) and returns 1.
activate() {
  local tag="$1" previous
  previous="$(current_tag)"
  if ! swap_current "$tag"; then FAIL_REASON="could not swap the current symlink to $tag"; return 1; fi
  if ! restart_demo; then
    restore_previous "$previous"
    FAIL_REASON="$RESTART_ERROR; $( [[ -n "$previous" ]] && echo "restored $previous" || echo "no previous release to restore")"
    return 1
  fi
  if [[ "$RESTART_STATE" == "restarted" ]] && ! wait_serving "$tag"; then
    restore_previous "$previous"
    FAIL_REASON="$tag did not answer on :$DEMO_PORT within ${HEALTH_BUDGET}s after the swap; $(rollback_note "$previous")"
    return 1
  fi
  say "Now serving $tag (${RESTART_STATE})."
}

# do_deploy <tag>: caller holds the lock. Writes the receipt. Returns 1 on failure.
do_deploy() {
  local tag="$1" previous
  previous="$(current_tag)"
  FAIL_REASON=""
  local on_main=0
  tag_on_main "$tag" || on_main=$?
  if [[ "$on_main" -ne 0 ]]; then
    if [[ "$on_main" -eq 2 ]]; then
      FAIL_REASON="cannot verify $tag: $MAIN_REF does not exist in $REPO (git fetch, or set ARCADIA_RELEASE_MAIN_REF)"
    else
      FAIL_REASON="$tag is not an ancestor of $MAIN_REF; release tags are cut from green main"
    fi
    receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
    return 1
  fi
  if ! build_release "$tag"; then
    receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
    return 1
  fi
  say "Smoke-testing $tag on staging port $STAGING_PORT"
  if ! start_staging "$RELEASES/$tag"; then
    receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
    return 1
  fi
  if ! smoke "$STAGING_PORT" "$STAGING_PID"; then
    if [[ -f "$LOG_DIR/staging-$tag.log" ]]; then tail -n 15 "$LOG_DIR/staging-$tag.log" >&2 || true; fi
    stop_staging
    receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
    return 1
  fi
  stop_staging
  if ! activate "$tag"; then
    receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
    return 1
  fi
  rm -f "$PIN_FILE" # an explicit deploy resumes nightly deploys
  receipt ok "$tag" "deployed ($RESTART_STATE)" "$previous" "$tag"
}

# --- notifications ------------------------------------------------------------

# notify <fyi|attention> <message>. Never fails the caller. Injectable:
# ARCADIA_RELEASE_NOTIFY_CMD is run as `<cmd> <kind> <message>`, and
# ARCADIA_RELEASE_NOTIFY=off disables notification (the tests do this).
notify() {
  local kind="$1" message="${2:0:450}" cli
  [[ "${ARCADIA_RELEASE_NOTIFY:-}" == "off" ]] && return 0
  if [[ -n "${ARCADIA_RELEASE_NOTIFY_CMD:-}" ]]; then
    "$ARCADIA_RELEASE_NOTIFY_CMD" "$kind" "$message" || warn "notify hook failed (ignored)"
    return 0
  fi
  # Both routes run under the release's own mise toolchain: under launchd the
  # bare PATH finds a different Node than the one the native sqlite module was
  # built for, and the ping would fail on an ABI mismatch.
  if [[ -f "$CURRENT/dist/src/cli.js" ]]; then
    rt "$CURRENT" "$CURRENT" node "$CURRENT/dist/src/cli.js" ping send --kind "$kind" \
      --agent "${ARCADIA_AGENT:-release-manager}" --workspace "$WORKSPACE" -- "$message" >/dev/null \
      || warn "ping failed (ignored): $message"
  elif cli="$(command -v arcadia 2>/dev/null)" && [[ -n "$cli" ]]; then
    rt "$REPO" "$REPO" "$cli" ping send --kind "$kind" --agent "${ARCADIA_AGENT:-release-manager}" \
      --workspace "$WORKSPACE" -- "$message" >/dev/null || warn "ping failed (ignored): $message"
  else
    warn "no arcadia CLI to send the ping with (ignored): $message"
  fi
}

# --- commands -----------------------------------------------------------------

cmd_list() {
  need_repo
  local dir name sha cur
  cur="$(current_tag)"
  say "Built releases in $RELEASES:"
  local found=0
  if [[ -d "$RELEASES" ]]; then
    for dir in "$RELEASES"/*/; do
      [[ -d "$dir" ]] || continue
      name="$(basename "$dir")"
      # `current` is a symlink to a release, not a release of its own.
      [[ "$name" == "logs" || -L "${dir%/}" ]] && continue
      if is_built "$name"; then
        sha="$(sed -n 's/^sha=//p' "$dir/.release-ok" | cut -c1-9)"
        say "  $name  built  ${sha}$( [[ "$name" == "$cur" ]] && echo '  <- current' )"
      else
        say "  $name  INCOMPLETE (no .release-ok; prune removes it)"
      fi
      found=1
    done
  fi
  [[ "$found" -eq 1 ]] || say "  (none)"
  say "Available release tags (newest first):"
  local tags
  tags="$(release_tags)"
  if [[ -z "$tags" ]]; then say "  (none match $TAG_PATTERN)"; return 0; fi
  while IFS= read -r name; do
    say "  $name  $(is_built "$name" && echo built || echo 'not built')"
  done <<< "$tags"
}

cmd_status() {
  local cur code
  cur="$(current_tag)"
  say "Releases:  $RELEASES"
  if [[ -n "$cur" ]]; then
    say "Current:   $cur$( is_built "$cur" || echo '  (WARNING: no .release-ok)' )"
  else
    say "Current:   none (no release has been deployed)"
  fi
  code="$(http_code "http://127.0.0.1:$DEMO_PORT/now" 5)"
  if [[ "$code" == "200" ]]; then say "Serving:   yes (http://127.0.0.1:$DEMO_PORT/now -> 200)"; else say "Serving:   NO (http://127.0.0.1:$DEMO_PORT/now -> $code)"; fi
  if agent_loaded; then say "Agent:     $LABEL loaded"; else say "Agent:     $LABEL not loaded"; fi
  if [[ -s "$PIN_FILE" ]]; then say "Pinned:    $(cat "$PIN_FILE") (nightly paused; 'deploy <tag>' resumes it)"; fi
  if [[ -s "$RECEIPTS" ]]; then say "Last receipt: $(tail -n 1 "$RECEIPTS")"; else say "Last receipt: none"; fi
}

cmd_build() {
  need_repo
  local tag="${1:-}"
  check_tag_name "$tag"
  check_tag_exists "$tag"
  lock_or_die
  if build_release "$tag"; then return 0; fi
  die "$FAIL_REASON"
}

cmd_deploy() {
  need_repo
  local tag="${1:-}"
  check_tag_name "$tag"
  # Best effort: the ancestry check below wants an up-to-date main.
  git -C "$REPO" fetch --tags --quiet 2>/dev/null || warn "git fetch --tags failed; using the refs already present."
  check_tag_exists "$tag"
  lock_or_die
  if do_deploy "$tag"; then return 0; fi
  warn "Deploy of $tag failed: $FAIL_REASON"
  warn "Still serving: $(current_tag || true)"
  exit 1
}

cmd_use() {
  need_repo
  local tag="${1:-}" previous
  check_tag_name "$tag"
  lock_or_die
  is_built "$tag" || die "$tag is not built (no $RELEASES/$tag/.release-ok); run: scripts/release.sh deploy $tag" 2
  built_matches_tag "$tag" || die "$tag was built from $(built_sha "$tag" | cut -c1-9) but the tag now points at $(tag_sha "$tag" | cut -c1-9); refusing to serve a stale build. Run: scripts/release.sh deploy $tag" 2
  previous="$(current_tag)"
  FAIL_REASON=""
  if activate "$tag"; then
    printf "%s\n" "$tag" > "$PIN_FILE" # a failover pins the tag: nightly must not undo it
    receipt ok "$tag" "failover ($RESTART_STATE)" "$previous" "$tag"
    return 0
  fi
  receipt failed "$tag" "$FAIL_REASON" "$previous" "$(current_tag)"
  die "use $tag failed: $FAIL_REASON"
}

nightly_fail() { # reason current
  receipt failed "" "$1" "$2" "$2"
  notify attention "Demo nightly could not run: $1. Still serving ${2:-nothing}."
  die "Nightly failed: $1" 1
}

cmd_nightly() {
  local newest cur
  cur="$(current_tag)"
  # The unattended job must never fail silently: a missing repo or a held lock
  # is recorded and pinged like any other failed deploy.
  if [[ -z "$REPO" || ! -d "$REPO" ]]; then
    nightly_fail "cannot resolve the primary repository (set ARCADIA_RELEASE_REPO)" "$cur"
  fi
  acquire_lock || nightly_fail "$FAIL_REASON" "$cur"
  if ! git -C "$REPO" fetch --tags --quiet; then
    warn "git fetch --tags failed; continuing with the tags already present."
  fi
  if [[ -s "$PIN_FILE" ]]; then
    say "Pinned to $(cat "$PIN_FILE") by 'use'; nightly is paused. Run 'deploy <tag>' to resume."
    receipt noop "$(cat "$PIN_FILE")" "pinned by use; nightly paused" "$cur" "$cur"
    return 0
  fi
  newest="$(release_tags | sed -n 1p)"
  if [[ -z "$newest" ]]; then
    receipt noop "" "no release tag matches $TAG_PATTERN" "$cur" "$cur"
    say "No release tags; nothing to do."
    return 0
  fi
  if [[ "$newest" == "$cur" ]]; then
    receipt noop "$newest" "already current" "$cur" "$cur"
    say "$newest is already serving; nothing to do."
    return 0
  fi
  say "Newest release tag is $newest; serving ${cur:-nothing}."
  if do_deploy "$newest"; then
    notify fyi "Demo is now serving $newest (was ${cur:-nothing}) on :$DEMO_PORT."
    return 0
  fi
  notify attention "Demo deploy of $newest FAILED: $FAIL_REASON. Still serving ${cur:-nothing}."
  warn "Nightly deploy of $newest failed: $FAIL_REASON"
  exit 1
}

cmd_prune() {
  need_repo
  lock_or_die
  local cur keep name dir kept=0 removed=0 tag
  cur="$(current_tag)"
  keep=" "
  [[ -n "$cur" ]] && keep=" $cur "
  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    if [[ "$kept" -lt "$KEEP_BUILDS" ]] && is_built "$tag"; then
      keep="$keep$tag "
      kept=$((kept + 1))
    fi
  done <<< "$(release_tags)"
  if [[ -d "$RELEASES" ]]; then
    for dir in "$RELEASES"/*/; do
      [[ -d "$dir" ]] || continue
      name="$(basename "$dir")"
      # Never touch `current` (a symlink: removing "through" it would delete the
      # serving release) or the logs.
      [[ "$name" == "logs" || -L "${dir%/}" ]] && continue
      case "$keep" in *" $name "*) say "keep   $name"; continue ;; esac
      if git -C "$REPO" worktree remove --force "${dir%/}" 2>/dev/null; then
        say "remove $name"
        removed=$((removed + 1))
      else
        warn "could not remove $name (not a removable worktree); left in place"
      fi
    done
  fi
  receipt ok "" "pruned $removed, kept$keep" "$cur" "$cur"
  say "Pruned $removed release(s)."
}

cmd_install_plan() {
  local mise mise_dir uid_cmd='$(id -u)' agents="$HOME/Library/LaunchAgents" logs="$HOME/Library/Logs/arcadia-demo"
  local app="$CURRENT/apps/dashboard" next_entry="$CURRENT/apps/dashboard/node_modules/next/dist/bin/next"
  local path_env script nightly_script
  mise="$(resolve_mise || true)"
  if [[ -z "$mise" ]]; then mise="/opt/homebrew/bin/mise"; MISE_NOTE=" (mise was not found on this machine; fix this path)"; else MISE_NOTE=""; fi
  mise_dir="$(dirname "$mise")"
  path_env="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  case ":$path_env:" in *":$mise_dir:"*) ;; *) path_env="$mise_dir:$path_env" ;; esac
  script="${REPO:-<arcadia repo>}/scripts/release.sh"
  nightly_script="$CURRENT/scripts/release.sh"

  cat <<EOF
# Stable demo deployment: install plan
#
# NOTHING BELOW HAS BEEN RUN. This command only prints. Installing LaunchAgents,
# the nightly job and the Tailscale entry is a deployment and needs an explicit
# operator Decision (CONSTITUTION.md); cutting a release tag is part of it.
#
# Demo server  : $LABEL, next start -H 0.0.0.0 -p $DEMO_PORT, from $CURRENT
# Workspace    : $WORKSPACE (shared with the development dashboard)
# Nightly job  : $NIGHTLY_LABEL at 04:00, runs: $nightly_script nightly (the script inside the serving release)
# Releases dir : $RELEASES
$( [[ -n "$MISE_NOTE" ]] && echo "# mise        : $mise$MISE_NOTE" || echo "# mise        : $mise" )

# --- 1. Build and promote the first release (creates $CURRENT) ------------------
# Needs a release tag that already exists (see: $script list).
$script deploy <tag>

# --- 2. Log directory -------------------------------------------------------------
mkdir -p "$logs"

# --- 3. The demo server agent ($LABEL) -----------------------------------------------
cat > "$agents/$LABEL.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$mise")</string>
    <string>-C</string>
    <string>$(xml_escape "$app")</string>
    <string>exec</string>
    <string>--</string>
    <string>node</string>
    <string>$(xml_escape "$next_entry")</string>
    <string>start</string>
    <string>-H</string>
    <string>0.0.0.0</string>
    <string>-p</string>
    <string>$DEMO_PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml_escape "$app")</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$logs/dashboard.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$logs/dashboard.err.log")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$path_env")</string>
    <key>HOME</key><string>$(xml_escape "$HOME")</string>
    <key>MISE_TRUSTED_CONFIG_PATHS</key><string>$(xml_escape "$RELEASES")</string>
    <key>ARCADIA_WORKSPACE</key><string>$(xml_escape "$WORKSPACE")</string>
    <key>ARCADIA_DASHBOARD_CLI</key><string>built</string>
    <key>ARCADIA_DASHBOARD_BASE_URL</key><string>http://127.0.0.1:$DEMO_PORT</string>
  </dict>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$uid_cmd" "$agents/$LABEL.plist"

# --- 4. The nightly agent ($NIGHTLY_LABEL) -------------------------------------------
# Fetches tags at 04:00 and deploys the newest release tag if it is not current.
# It runs the script from the serving release, so cut the first release tag from
# a main that already contains scripts/release.sh.
# git fetch needs credentials that launchd can reach (an https remote with the
# keychain works; an ssh remote needs an agent socket launchd does not have).
cat > "$agents/$NIGHTLY_LABEL.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml_escape "$NIGHTLY_LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$nightly_script")</string>
    <string>nightly</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>4</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$(xml_escape "$logs/nightly.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$logs/nightly.err.log")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml_escape "$path_env")</string>
    <key>HOME</key><string>$(xml_escape "$HOME")</string>
    <key>ARCADIA_WORKSPACE</key><string>$(xml_escape "$WORKSPACE")</string>
    <key>ARCADIA_RELEASES_DIR</key><string>$(xml_escape "$RELEASES")</string>
    <key>ARCADIA_RELEASE_REPO</key><string>$(xml_escape "${REPO:-<arcadia repo>}")</string>
    <key>ARCADIA_MISE_BIN</key><string>$(xml_escape "$mise")</string>
    <key>ARCADIA_DEMO_PORT</key><string>$DEMO_PORT</string>
    <key>ARCADIA_DEMO_STAGING_PORT</key><string>$STAGING_PORT</string>
    <key>ARCADIA_DEMO_LABEL</key><string>$(xml_escape "$LABEL")</string>
  </dict>
</dict>
</plist>
PLIST
launchctl bootstrap "gui/$uid_cmd" "$agents/$NIGHTLY_LABEL.plist"

# --- 5. Optional: a Tailscale name without a port ----------------------------------------
# http://<tailnet-host>:$DEMO_PORT already works. This adds https://<tailnet-host>/ on 443.
tailscale serve --bg --https=443 http://127.0.0.1:$DEMO_PORT

# --- Verify -----------------------------------------------------------------------
$script status

# --- Undo -------------------------------------------------------------------------
launchctl bootout "gui/$uid_cmd/$LABEL"
launchctl bootout "gui/$uid_cmd/$NIGHTLY_LABEL"
rm "$agents/$LABEL.plist" "$agents/$NIGHTLY_LABEL.plist"
tailscale serve --https=443 off
EOF
}

case "$CMD_NAME" in
  list) cmd_list ;;
  status) cmd_status ;;
  build) cmd_build "${2:-}" ;;
  deploy) cmd_deploy "${2:-}" ;;
  use) cmd_use "${2:-}" ;;
  nightly) cmd_nightly ;;
  prune) cmd_prune ;;
  install-plan) cmd_install_plan ;;
  *) usage ;;
esac
