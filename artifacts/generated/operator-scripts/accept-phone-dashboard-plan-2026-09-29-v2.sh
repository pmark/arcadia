#!/usr/bin/env bash
set -euo pipefail
library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-}" in
  --describe)
    cat "${library_dir}/accept-phone-dashboard-plan-2026-09-29-v2.json"
    ;;
  run)
    run_dir="${library_dir}/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    export ARCADIA_PLAN_ACCEPT_RECEIPT_DIR="$run_dir"
    if python3 - <<'PY' >"$run_dir/run.log" 2>&1
import hashlib, json, os, pathlib, signal, subprocess, sys
root = pathlib.Path("/Users/pmark/.codex/worktrees/runs-information-architecture/arcadia")
out = pathlib.Path(os.environ["ARCADIA_PLAN_ACCEPT_RECEIPT_DIR"])
ask = "agent-ask-plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2.yaml"
branch = "codex/runs-information-architecture"
def command(args, timeout=30):
    proc = subprocess.Popen(args, cwd=root, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            output, _ = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            output, _ = proc.communicate()
        print(output, flush=True)
        raise RuntimeError("Bounded command timed out: " + args[0])
    if proc.returncode:
        print(output, flush=True)
        raise RuntimeError("Command refused: " + args[0])
    return output
try:
    if not root.is_dir():
        raise RuntimeError("Reviewed candidate worktree is missing; do not accept on another checkout.")
    if command(["git", "branch", "--show-current"]).strip() != branch:
        raise RuntimeError("Candidate branch changed; do not accept on another branch.")
    if command(["git", "remote", "get-url", "origin"]).strip() != "https://github.com/pmark/arcadia.git":
        raise RuntimeError("Candidate repository changed.")
    if command(["git", "status", "--porcelain"]).strip():
        raise RuntimeError("Candidate is dirty; preserve and review its changes before retrying.")
    files = [root / ".arcadia/asks" / ask, root / ".arcadia/asks/archive" / ask]
    current = next((p for p in files if p.is_file()), None)
    if current is None or hashlib.sha256(current.read_bytes()).hexdigest() != "625ef7ad45bc9d262feb16d146695cf9a9ea0aaad456d630bfbb5835682142e0":
        raise RuntimeError("The reviewed Plan input is missing or changed; ask the agent to refresh this action.")
    os.environ.update(GIT_AUTHOR_NAME="Cody Atlas", GIT_AUTHOR_EMAIL="cody.atlas@agents.arcadia.local",
                      GIT_COMMITTER_NAME="Cody Atlas", GIT_COMMITTER_EMAIL="cody.atlas@agents.arcadia.local")
    output = command(["mise", "exec", "--", "node", "--import", "tsx", "src/cli.ts",
        "agent-ask", "settle", "--proposal", "plan-phone-dashboard-judgment-actions-runs-2026-09-29-v2",
        "--request-id", "accept-phone-dashboard-plan-2026-09-29-v2", "--disposition", "accepted",
        "--responsibility", "agent", "--preview",
        "124b628b9f8e396e9e4365310ca7f82ed8f7dc601ae57639f439d647035108c5",
        "--operator", "--apply", "--json"], timeout=300)
    result = json.loads(output)
    (out / "settlement-receipt.json").write_text(json.dumps(result, indent=2) + "\n")
    receipt = result.get("data", {}).get("receipt", {})
    if not result.get("ok") or not receipt.get("applied") or receipt.get("disposition") != "accepted":
        raise RuntimeError("Arcadia did not confirm the exact inactive-Plan acceptance.")
    if command(["git", "status", "--porcelain"]).strip():
        raise RuntimeError("Settlement left recovery files; review before pushing.")
    # Publish only the candidate branch's canonical settlement. Never push main.
    print(command(["git", "push", "origin", "HEAD:refs/heads/" + branch], timeout=120), flush=True)
    print("Inactive Plan accepted and candidate branch published. No queue, pointer or production change.")
    print("Next: have the agent rerun this PR's CodeRabbit/check loop, then choose Plan activation and queue placement separately.")
except Exception as error:
    message = ("Acceptance or publication stopped: " + str(error) +
        "\nNext: ask the agent to inspect this run.log and any settlement-receipt.json, preserve applied evidence, "
        "refresh the exact proposal if stale, and retry this action only while inactive-Plan acceptance remains intended. "
        "Do not activate, reset state or reconcile Git manually.\n")
    (out / "failure-handoff.txt").write_text(message)
    print(message, file=sys.stderr, flush=True)
    sys.exit(1)
PY
    then
      cat "$run_dir/run.log"
      printf 'Receipt: %s/settlement-receipt.json\n' "$run_dir"
    else
      cat "$run_dir/run.log" >&2
      printf 'Failure handoff: %s/failure-handoff.txt\n' "$run_dir" >&2
      exit 1
    fi
    ;;
  *)
    printf 'Usage: %s run|--describe\n' "$0" >&2
    exit 64
    ;;
esac

