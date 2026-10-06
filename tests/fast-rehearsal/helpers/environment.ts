import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Process isolation for one fast-rehearsal test file.
 *
 * Every scenario runs against a temporary Project repository, workspace and
 * local bare remote. This module makes sure nothing else is reachable even by
 * accident:
 *
 * - `HOME` and `XDG_CONFIG_HOME` point into a fresh temporary directory, so
 *   no user configuration (the Arcadia user config that names the live
 *   workspace, `~/.gitconfig`, provider homes) is read or written;
 *   `GIT_CONFIG_NOSYSTEM` keeps the system Git configuration out too.
 * - `ARCADIA_WORKSPACE` names a directory that does not exist until a
 *   scenario points it at its own temporary workspace, so a default
 *   workspace resolution can never land on the live one.
 * - `PATH` starts with guard binaries for `gh`, `claude`, `codex` and
 *   `opencode`. The harness injects every one of those seams through the
 *   lifecycle's own dependency options; if any code path still execs the real
 *   binary, the guard runs instead, records the call and exits 97. Every
 *   scenario asserts the guard log is empty.
 * - `PATH` also carries a `tmux` fake: read-only queries (`-V`,
 *   `has-session`) are answered from the injected FakeTmux's live set (the
 *   world writes it to {@link IsolatedProcess.tmuxLive}); any other tmux
 *   command is refused and recorded like the guards.
 *
 * {@link restore} puts the previous environment back.
 */
export interface IsolatedProcess {
  root: string;
  home: string;
  bin: string;
  guardLog: string;
  /** One live tmux session name per line, kept by the scenario world; the PATH `tmux` fake reads it. */
  tmuxLive: string;
  /** The original `HOME`, for sanitising paths in reports. */
  originalHome: string;
  guardCalls(): string[];
  restore(): void;
}

const GUARDED = ["gh", "claude", "codex", "opencode"] as const;
const KEYS = ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_NOSYSTEM", "PATH", "ARCADIA_WORKSPACE", "ARCADIA_PRESERVATION_HOST_TEST"] as const;

export function isolateProcess(): IsolatedProcess {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "arcadia-fast-rehearsal-env-")));
  const home = path.join(root, "home");
  const bin = path.join(root, "guard-bin");
  const guardLog = path.join(root, "guard-calls.log");
  const tmuxLive = path.join(root, "tmux-live-sessions");
  writeFileSync(tmuxLive, "");
  mkdirSync(path.join(home, ".config"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  for (const name of GUARDED) {
    const file = path.join(bin, name);
    writeFileSync(file, `#!/bin/sh
# fast-rehearsal guard: the real ${name} must never run inside the harness.
printf '%s\\t%s\\t%s\\n' ${shellQuote(name)} "$(pwd -P)" "$*" >> ${shellQuote(guardLog)}
echo "fast-rehearsal guard: refused to run the real ${name} ($*)" >&2
exit 97
`);
    chmodSync(file, 0o755);
  }
  // tmux is faked, not only guarded: some read paths (the queue's transition
  // resolver in src/dispatch/queue.ts, which a settlement runs) query the
  // default `systemTmux` rather than the injected adapter. This fake answers
  // `-V` and `has-session -t =<name>` from the same live set the injected
  // FakeTmux holds, and refuses (and records) anything else.
  writeFileSync(path.join(bin, "tmux"), `#!/bin/sh
case "$1" in
  -V) echo "tmux 3.4 (fast-rehearsal fake)"; exit 0 ;;
  has-session)
    name=$(printf '%s' "$3" | sed 's/^=//')
    grep -qxF -- "$name" ${shellQuote(tmuxLive)} && exit 0
    exit 1 ;;
esac
printf '%s\\t%s\\t%s\\n' tmux "$(pwd -P)" "$*" >> ${shellQuote(guardLog)}
echo "fast-rehearsal guard: refused to run the real tmux ($*)" >&2
exit 97
`);
  chmodSync(path.join(bin, "tmux"), 0o755);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.PATH = `${bin}${path.delimiter}${saved.PATH ?? ""}`;
  process.env.ARCADIA_WORKSPACE = path.join(root, "no-workspace-selected");
  return {
    root,
    home,
    bin,
    guardLog,
    tmuxLive,
    originalHome: saved.HOME ?? "",
    guardCalls: () => (existsSync(guardLog) ? readFileSync(guardLog, "utf8").split("\n").filter(Boolean) : []),
    restore: () => {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      rmSync(root, { recursive: true, force: true });
    }
  };
}

/** The absolute path of the real `git`, resolved once before any shim is on PATH. */
export function realGit(): string {
  return execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
}

/**
 * A one-shot Git fault: a `git` shim, first on PATH, that fails the next
 * `count` invocations of one subcommand (exit 128, a fixed stderr line) and
 * passes every other invocation to the real Git unchanged. Production code
 * resolves `git` through PATH (`execFileSync("git", ...)`), so this reaches
 * exactly the lifecycle's own Git calls; nothing in the lifecycle is
 * replaced.
 */
export interface GitFaults {
  dir: string;
  /** Arm `count` failures of `git <subcommand>`. */
  arm(subcommand: string, count?: number): void;
  /** Every injected failure: subcommand, working directory and argv. */
  injected(): Array<{ subcommand: string; cwd: string; argv: string }>;
  /** Remove the shim from PATH. */
  remove(): void;
}

export function installGitFaults(root: string): GitFaults {
  const dir = path.join(root, "git-fault-bin");
  const rules = path.join(dir, "rules");
  const log = path.join(dir, "injected.log");
  mkdirSync(rules, { recursive: true });
  const git = realGit();
  // POSIX sh, not node: Git runs hundreds of times per scenario and a node
  // start per call would dominate the run time.
  writeFileSync(path.join(dir, "git"), `#!/bin/sh
sub=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    -C|-c|--git-dir|--work-tree|--namespace|--exec-path) skip=1 ;;
    -*) ;;
    *) sub="$a"; break ;;
  esac
done
rule=${shellQuote(rules)}/"$sub"
if [ -n "$sub" ] && [ -f "$rule" ]; then
  n=$(cat "$rule")
  if [ "$n" -gt 0 ]; then
    echo $((n - 1)) > "$rule"
    printf '%s\\t%s\\t%s\\n' "$sub" "$(pwd -P)" "$*" >> ${shellQuote(log)}
    echo "fatal: injected fault: git $sub failed once (fast-rehearsal)" >&2
    exit 128
  fi
fi
exec ${shellQuote(git)} "$@"
`);
  chmodSync(path.join(dir, "git"), 0o755);
  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${dir}${path.delimiter}${previousPath}`;
  return {
    dir,
    arm: (subcommand, count = 1) => writeFileSync(path.join(rules, subcommand), `${count}\n`),
    injected: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => {
      const [subcommand, cwd, argv] = line.split("\t");
      return { subcommand, cwd, argv };
    }) : []),
    remove: () => {
      process.env.PATH = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry !== dir).join(path.delimiter);
    }
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
