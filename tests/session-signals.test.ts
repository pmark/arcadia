import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySession,
  detectRepeatedCommandLoop,
  PANE_CLASS_PRECEDENCE,
  PANE_SIGNAL_CATALOG,
  scanPane,
  SESSION_STATE_ACTION,
  type PaneSignalClass,
  type SessionSignals,
  type SessionState
} from "../src/production/sessionSignals.js";

// Fixtures are CONSTRUCTED from real provider output strings (Claude Code,
// Codex, GitHub CLI, macOS sandbox). No captured live pane transcripts existed
// in artifacts/ or the workspace to replay; see docs/session-signal-classifier.md.
const FIXTURE_DIR = path.join(import.meta.dirname, "fixtures", "pane-transcripts");
const pane = (name: string): string => readFileSync(path.join(FIXTURE_DIR, `${name}.txt`), "utf8");

/** A live Session that the stall detector has flagged: the worst case for misclassification. */
function stalledLive(paneText: string | null): SessionSignals {
  return {
    process: { alive: true, exitStatus: null },
    paneText,
    stalled: true,
    git: { commitsAhead: 1, dirty: false },
    runStatus: "running",
    preservation: null,
    draftedCompletion: false,
    pr: { state: null },
    claimHeld: true
  };
}

describe("pane catalog replay", () => {
  const cases: Array<[string, PaneSignalClass]> = [
    ["claude-usage-limit", "provider_limit"],
    ["codex-usage-limit", "provider_limit"],
    ["claude-auth-expired", "auth_failure"],
    ["github-scope-failure", "auth_failure"],
    ["claude-permission-prompt", "permission_prompt"],
    ["codex-approval-prompt", "permission_prompt"],
    ["sandbox-denial", "sandbox_denial"],
    ["claude-context-exhausted", "context_exhaustion"],
    ["codex-context-exhausted", "context_exhaustion"],
    ["repeated-command-loop", "command_loop"]
  ];

  it.each(cases)("%s is recognised as %s", (name, expected) => {
    expect(scanPane(pane(name)).classes).toContain(expected);
  });

  it("covers every catalog class with at least one fixture", () => {
    expect(new Set(cases.map(([, c]) => c))).toEqual(new Set(PANE_CLASS_PRECEDENCE));
  });

  it("every regex catalog entry belongs to a precedence class", () => {
    for (const entry of PANE_SIGNAL_CATALOG) expect(PANE_CLASS_PRECEDENCE).toContain(entry.class);
  });

  it("a benign idle pane matches nothing", () => {
    expect(scanPane(pane("benign-idle-stall")).classes).toEqual([]);
    expect(scanPane(null).classes).toEqual([]);
  });

  it("ignores a limit message scrolled out of the recent tail", () => {
    const old = "Claude usage limit reached. Your limit will reset at 3pm.\n";
    const later = Array.from({ length: 60 }, (_, i) => `⏺ Read(file${i}.ts)`).join("\n");
    expect(scanPane(old + later).classes).toEqual([]);
  });

  it("detects a loop only for at least four consecutive identical commands", () => {
    expect(detectRepeatedCommandLoop(["⏺ Bash(a)", "⏺ Bash(a)", "⏺ Bash(a)"])).toBe(false);
    expect(detectRepeatedCommandLoop(["⏺ Bash(a)", "⏺ Bash(b)", "⏺ Bash(a)", "⏺ Bash(b)"])).toBe(false);
    expect(detectRepeatedCommandLoop(Array(4).fill("⏺ Bash(a)"))).toBe(true);
  });
});

describe("classifier: signals never masquerade as stalls", () => {
  const blocked: Array<[string, SessionState]> = [
    ["claude-usage-limit", "provider_limit"],
    ["codex-usage-limit", "provider_limit"],
    ["claude-auth-expired", "auth_failure"],
    ["github-scope-failure", "auth_failure"],
    ["claude-permission-prompt", "permission_prompt"],
    ["codex-approval-prompt", "permission_prompt"],
    ["sandbox-denial", "sandbox_denial"],
    ["claude-context-exhausted", "context_exhaustion"],
    ["codex-context-exhausted", "context_exhaustion"],
    ["repeated-command-loop", "command_loop"]
  ];

  it.each(blocked)("%s with stall indicators set classifies as %s, not stalled", (name, state) => {
    const result = classifySession(stalledLive(pane(name)));
    expect(result.state).toBe(state);
    expect(result.state).not.toBe("stalled");
    expect(result.action).toBe(SESSION_STATE_ACTION[state]);
    expect(result.paneMatches.length).toBeGreaterThan(0);
  });

  it("a stalled Session with a benign pane is stalled", () => {
    const result = classifySession(stalledLive(pane("benign-idle-stall")));
    expect(result).toMatchObject({ state: "stalled", action: "recover_stalled_session" });
  });

  it("overlap: a provider limit beats a repeated-command loop", () => {
    expect(classifySession(stalledLive(pane("overlap-limit-during-loop"))).state).toBe("provider_limit");
    expect(scanPane(pane("overlap-limit-during-loop")).classes).toEqual(["provider_limit", "command_loop"]);
  });

  it("overlap: a permission prompt beats a sandbox denial", () => {
    expect(classifySession(stalledLive(pane("overlap-sandbox-then-approval"))).state).toBe("permission_prompt");
  });

  it("overlap: an auth failure beats a provider limit", () => {
    expect(classifySession(stalledLive(pane("overlap-auth-and-limit"))).state).toBe("auth_failure");
  });

  it("a blocking pane signal still wins when the process has died", () => {
    const signals = { ...stalledLive(pane("claude-usage-limit")), process: { alive: false, exitStatus: 1 } };
    expect(classifySession(signals).state).toBe("provider_limit");
  });
});

describe("classifier: non-pane signals", () => {
  const base = stalledLive(null);

  it("closed state set maps every state to exactly one action", () => {
    expect(Object.keys(SESSION_STATE_ACTION).sort()).toEqual(
      [
        "completed_merged", "completion_drafted", "permission_prompt", "auth_failure", "provider_limit",
        "sandbox_denial", "context_exhaustion", "command_loop", "stalled", "exited_unpreserved",
        "exited_preserved", "exited_failed", "exited_clean", "working", "unobservable"
      ].sort()
    );
  });

  it("a merged PR outranks everything, including pane blocks", () => {
    const s = { ...stalledLive(pane("claude-usage-limit")), pr: { state: "merged" as const } };
    expect(classifySession(s)).toMatchObject({ state: "completed_merged", action: "release_claim" });
  });

  it("a drafted completion outranks pane blocks", () => {
    const s = { ...stalledLive(pane("claude-permission-prompt")), draftedCompletion: true };
    expect(classifySession(s)).toMatchObject({ state: "completion_drafted", action: "settle_drafted_completion" });
  });

  it("a dead process with unpreserved work must be preserved", () => {
    const s: SessionSignals = { ...base, process: { alive: false, exitStatus: 0 }, stalled: null, preservation: "LOCAL ONLY" };
    expect(classifySession(s)).toMatchObject({ state: "exited_unpreserved", action: "preserve_candidate" });
    const dirty: SessionSignals = { ...s, git: { commitsAhead: 0, dirty: true }, preservation: null };
    expect(classifySession(dirty).state).toBe("exited_unpreserved");
  });

  it("a dead process with a pushed or PR'd candidate awaits review", () => {
    const pushed: SessionSignals = { ...base, process: { alive: false, exitStatus: 0 }, stalled: null, preservation: "PUSHED" };
    expect(classifySession(pushed).state).toBe("exited_preserved");
    const open: SessionSignals = { ...pushed, preservation: "IN PR", pr: { state: "open" } };
    expect(classifySession(open)).toMatchObject({ state: "exited_preserved", action: "await_pr_review" });
  });

  it("a dead process with no work is failed or clean by exit status and Run", () => {
    const none = { git: { commitsAhead: 0, dirty: false }, stalled: null, preservation: null };
    expect(classifySession({ ...base, ...none, process: { alive: false, exitStatus: 2 } }).state).toBe("exited_failed");
    expect(classifySession({ ...base, ...none, process: { alive: false, exitStatus: 0 }, runStatus: "failed" }).state).toBe("exited_failed");
    expect(classifySession({ ...base, ...none, process: { alive: false, exitStatus: 0 }, runStatus: "completed" }).state).toBe("exited_clean");
  });

  it("a live, unstalled Session is working; nothing observed is unobservable", () => {
    expect(classifySession({ ...base, stalled: false, paneText: pane("benign-idle-stall") }).state).toBe("working");
    expect(classifySession({ ...base, stalled: null, paneText: null }).state).toBe("unobservable");
  });
});
