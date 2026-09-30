#!/usr/bin/env bash
set -euo pipefail

library_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_id="accept-close-ask-traceability-scope-2026-09-30"

case "${1:-}" in
  --describe)
    cat "$library_dir/${script_id}.json"
    ;;
  run)
    run_dir="$library_dir/runs/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$run_dir"
    if python3 - "$library_dir" "$run_dir" <<'PY' >"$run_dir/run.log" 2>&1
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import sys

library = pathlib.Path(sys.argv[1]).resolve()
run_dir = pathlib.Path(sys.argv[2])
repo = library.parent.parent.parent
ask_name = "agent-ask-amend-close-ask-traceability-scope-2026-09-30.yaml"
ask_sha256 = "278c26b71a2779cfbc8c3e91c36ebf9bb87699ab3d7f0e12ceae05ad3abb4468"
proposal = "amend-close-ask-traceability-scope-2026-09-30"
settlement = "accept-close-ask-traceability-scope-2026-09-30"
fingerprint = "c5bb16f5c727a096a06c80d802aae2df355787aefa16c3d4c964d3daf19457bd"
reviewed_base = "90ddc594fc4712df95a594829a45aa9538efb1dd"
original = [
    "#591: A command maps a capture_… id to the ask, back-burner item, or Action it produced.",
    "#716: The arcadia-go skill's node_modules bridge step works on a target repo that is not Arcadia's own monorepo.",
]
amended = [
    "#591: Every resulting Ask record carries its originating capture_id.",
    "#591: arcadia ask show <capture_…|request id> maps a capture or request to the Ask, back-burner item, or Action it produced.",
    "#591: The dashboard exposes a receipt link for each capture-to-result trace.",
    "#591: Objective tests cover capture_id propagation, capture/request lookup, dashboard receipt links, and every resulting record type.",
    "#716: The arcadia-go skill’s node_modules bridge step works on a target repo that is not Arcadia’s own monorepo.",
]

def command(args, timeout=60):
    process = subprocess.Popen(args, cwd=repo, text=True, stdout=subprocess.PIPE,
                               stderr=subprocess.STDOUT, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            output, _ = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            output, _ = process.communicate()
        print(output, flush=True)
        raise RuntimeError("bounded command timed out: " + " ".join(args))
    if process.returncode:
        print(output, flush=True)
        raise RuntimeError("command refused: " + " ".join(args))
    return output

def action_block(path):
    text = path.read_text()
    marker = "  - id: close-ask-traceability-and-cli-portability-gaps\n"
    if text.count(marker) != 1:
        raise RuntimeError("the reviewed Action is missing or duplicated")
    block = text.split(marker, 1)[1].split("\n  - id: ", 1)[0]
    return block

def criteria(block):
    marker = "    acceptance_criteria:\n"
    if marker not in block:
        raise RuntimeError("the reviewed Action has no acceptance criteria")
    section = block.split(marker, 1)[1]
    result = []
    for line in section.splitlines():
        if not line.startswith("      - "):
            break
        value = line.removeprefix("      - ")
        if len(value) >= 2 and value[0] == value[-1] == '"':
            value = value[1:-1]
        result.append(value)
    return result

try:
    if not repo.is_dir() or (repo / ".git").exists() is False:
        raise RuntimeError("the operator-script library is not in the reviewed Arcadia main checkout")
    if command(["git", "remote", "get-url", "origin"]).strip() != "https://github.com/pmark/arcadia.git":
        raise RuntimeError("repository origin is not pmark/arcadia")
    if command(["git", "branch", "--show-current"]).strip() != "main":
        raise RuntimeError("refuse outside the main checkout")
    if command(["git", "status", "--porcelain"]).strip():
        raise RuntimeError("main checkout is dirty; preserve unrelated work before accepting")
    command(["git", "fetch", "origin", "main"], timeout=120)
    if command(["git", "rev-parse", "HEAD"]).strip() != command(["git", "rev-parse", "origin/main"]).strip():
        raise RuntimeError("main is not exactly origin/main; pull or resolve the reviewed main revision first")
    command(["git", "merge-base", "--is-ancestor", reviewed_base, "HEAD"])

    ask = repo / ".arcadia" / "asks" / ask_name
    if not ask.is_file() or hashlib.sha256(ask.read_bytes()).hexdigest() != ask_sha256:
        raise RuntimeError("reviewed Ask input is missing or has changed")
    project = repo / "PROJECT.md"
    if "active_plan: bootstrap-managed-production-to-build-flight-deck" not in project.read_text() or "current_action: prove-two-action-unattended-production" not in project.read_text():
        raise RuntimeError("project pointer changed; do not apply this stale, bounded amendment")
    block = action_block(repo / "docs/plans/bootstrap-managed-production-to-build-flight-deck.md")
    if "    status: open\n" not in block or "    responsibility: agent\n" not in block:
        raise RuntimeError("reviewed Action no longer has its expected open agent state")
    current = criteria(block)
    if current not in (original, amended):
        raise RuntimeError("reviewed Action acceptance changed; do not apply a stale amendment")
    if 'https://github.com/pmark/arcadia/issues/591' not in block or 'https://github.com/pmark/arcadia/issues/716' not in block:
        raise RuntimeError("reviewed Action references changed")

    output = command(["mise", "exec", "--", "pnpm", "-s", "arcadia", "agent-ask", "settle",
        "--proposal", proposal, "--request-id", settlement, "--disposition", "accepted",
        "--preview", fingerprint, "--operator", "--apply", "--json"], timeout=300)
    result = json.loads(output)
    (run_dir / "settlement-receipt.json").write_text(json.dumps(result, indent=2) + "\\n")
    receipt = result.get("data", {}).get("receipt", {})
    if not result.get("ok") or not receipt.get("applied") or receipt.get("disposition") != "accepted":
        raise RuntimeError("Arcadia did not confirm the exact Plan-amendment settlement")
    if command(["git", "status", "--porcelain"]).strip():
        raise RuntimeError("settlement left uncommitted recovery files; review before publication")
    print(command(["git", "push", "origin", "HEAD:refs/heads/main"], timeout=120), flush=True)
    print("Exact traceability-scope amendment accepted and main published. No queue, pointer, production, Grant, restart, credential, or PR change.")
except Exception as error:
    message = ("Acceptance or publication stopped: " + str(error) + "\\n"
               "Next: inspect run.log and settlement-receipt.json. If settlement applied but publication failed, preserve the receipt; "
               "this action can replay only while main, the Ask hash, the preview fingerprint, and the bounded Action state still match. "
               "Do not settle a different proposal, edit governance by hand, alter the queue, or use this action for production control.\\n")
    (run_dir / "failure-handoff.txt").write_text(message)
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
