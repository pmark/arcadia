import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Scaffolds a project's `scripts/services.sh` as an unfinished placeholder.
 *
 * Adoption writes the governance documents a project needs; this writes the one
 * executable it needs, in the shape `docs/service-contract.md` defines, so a
 * coding agent completing it is filling in three known blanks rather than
 * inventing an interface.
 *
 * **It refuses to overwrite.** Every other file adoption writes is either
 * generated or adopted verbatim, so rewriting it is correct. This one is
 * project-specific and hand-written, and clobbering a working service script
 * would be the most destructive thing adoption could do.
 *
 * **The placeholder fails loudly.** A stub that exited 0 and did nothing would
 * make `qa refresh` report "services restarted" when nothing had been, which is
 * the same class of lie as a hand-typed freshness string — plausible, wrong,
 * and invisible. Until the blanks are filled it exits non-zero and says why.
 */

export const SERVICE_SCRIPT_RELATIVE = path.join("scripts", "services.sh");

export const SERVICE_SCRIPT_TEMPLATE = `#!/usr/bin/env bash
#
# Service control for this project. Arcadia calls this; see the contract at
# docs/service-contract.md in the Arcadia repository.
#
#   scripts/services.sh status    report what is running, exit 0 either way
#   scripts/services.sh restart   stop and start every service this project owns
#   scripts/services.sh stop      stop every service this project owns
#
# Two rules that matter:
#
#   1. Never touch git. Arcadia brings the checkout to its base branch before
#      calling this, under a safety contract a shell script cannot honour.
#      Pulling here would race that and could destroy uncommitted work.
#
#   2. Restart from the current working tree. Whatever is checked out now is
#      what the operator is about to test.
#
# TO COMPLETE THIS FILE: replace the three marked blocks below, then delete the
# not-implemented guard at the bottom of each. Until then every verb exits
# non-zero on purpose — a stub that silently succeeded would make Arcadia
# report a restart that never happened.

set -euo pipefail
cd "$(dirname "\${BASH_SOURCE[0]}")/.."

ACTION="\${1:-status}"

not_implemented() {
  echo "scripts/services.sh: '$1' is not implemented yet for this project." >&2
  echo "Complete the marked block in $(pwd)/scripts/services.sh." >&2
  exit 2
}

case "$ACTION" in
  status)
    # --- REPLACE: report what is running, one line per service. ---------------
    # Exit 0 whether or not everything is up; "nothing is running" is a status,
    # not a failure. Example:
    #   pgrep -fl "my-project-dev" || echo "not running"
    # -------------------------------------------------------------------------
    not_implemented status
    ;;

  restart)
    # --- REPLACE: stop, then start, every service this project owns. ----------
    # Prefer something that survives a logout (launchd on macOS, systemd on
    # Linux) over a bare background process. Write logs somewhere findable and
    # print where. Example:
    #   "$0" stop; sleep 1; pnpm dev >/dev/null 2>&1 &
    # -------------------------------------------------------------------------
    not_implemented restart
    ;;

  stop)
    # --- REPLACE: stop every service this project owns, leaving no orphans. ---
    # Example:
    #   pkill -f "my-project-dev" || true
    # -------------------------------------------------------------------------
    not_implemented stop
    ;;

  *)
    echo "usage: $0 [status|restart|stop]" >&2
    exit 2
    ;;
esac
`;

export interface ServiceScaffoldResult {
  /** Absolute path, whether it was written now or already existed. */
  path: string;
  /** False when a script was already present and left exactly as it was. */
  written: boolean;
}

export function scaffoldServiceScript(repoPath: string): ServiceScaffoldResult {
  const absolute = path.join(repoPath, SERVICE_SCRIPT_RELATIVE);
  if (existsSync(absolute)) {
    return { path: absolute, written: false };
  }

  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, SERVICE_SCRIPT_TEMPLATE, "utf8");
  // Discovery finds the script by path, and spawning it needs the bit set. A
  // scaffolded file that is found but cannot be executed is a worse state than
  // no file at all, because it looks configured.
  chmodSync(absolute, 0o755);
  return { path: absolute, written: true };
}
