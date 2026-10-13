import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve(__dirname, "..", "scripts", "services.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

/** A stand-in for the external restart script that fails its first `failures` restarts. */
function stubImpl(failures: number): { impl: string; calls: string } {
  const root = tempDir("arcadia-services-");
  const impl = path.join(root, "impl.sh");
  const calls = path.join(root, "calls");
  writeFileSync(
    impl,
    `#!/usr/bin/env bash
echo "$1" >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
if [[ "$1" == "restart" && "$n" -le ${failures} ]]; then exit 28; fi
exit 0
`
  );
  chmodSync(impl, 0o755);
  // The post-restart `pnpm arcadia go-broker ensure` is not under test; stub it.
  const pnpm = path.join(root, "pnpm");
  writeFileSync(pnpm, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(pnpm, 0o755);
  writeFileSync(calls, "");
  return { impl, calls };
}

function runRestart(impl: string, attempts: string, extraEnv: Record<string, string> = {}) {
  return spawnSync("bash", [script, "restart"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${path.dirname(impl)}:${process.env.PATH ?? ""}`,
      ARCADIA_RESTART_SCRIPT: impl,
      ARCADIA_RESTART_RETRY_DELAY: "0",
      ARCADIA_RESTART_ATTEMPTS: attempts,
      // Keep the post-restart go-broker step away from the operator's real state.
      HOME: tempDir("arcadia-services-home-"),
      // The dashboard warm-up is covered by its own test.
      ARCADIA_DASHBOARD_WARM: "0",
      ...extraEnv
    }
  });
}

describe.skipIf(os.platform() !== "darwin")("scripts/services.sh restart (Issue #430)", () => {
  it("retries when a single readiness probe fails the restart", () => {
    const { impl, calls } = stubImpl(1);
    const result = runRestart(impl, "2");
    expect(result.stderr).toContain("retrying");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("still fails, with the original exit code, once the bounded attempts are spent", () => {
    const { impl, calls } = stubImpl(5);
    const result = runRestart(impl, "2");
    expect(result.status).toBe(28);
    expect(result.stderr).toContain("Restart failed after 2 attempt(s).");
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("refuses an invalid attempt limit before restarting anything", () => {
    for (const bad of ["08", "0", "abc", "99"]) {
      const { impl, calls } = stubImpl(0);
      const result = runRestart(impl, bad);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("ARCADIA_RESTART_ATTEMPTS");
      expect(readFileSync(calls, "utf8")).toBe("");
    }
  });
});

describe.skipIf(os.platform() !== "darwin")("scripts/services.sh restart dashboard warm-up", () => {
  it("warms /production and its API reads after a successful restart", async () => {
    const { impl } = stubImpl(0);
    const warmed = path.join(path.dirname(impl), "warmed");
    const curl = path.join(path.dirname(impl), "curl");
    writeFileSync(curl, `#!/usr/bin/env bash\necho "\${@: -1}" >> "${warmed}"\n`);
    chmodSync(curl, 0o755);
    const result = runRestart(impl, "1", { ARCADIA_DASHBOARD_WARM: "1", ARCADIA_DASHBOARD_URL: "http://dash.test" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PR routes warmed; inventory may still be refreshing");
    // The warm-up is detached; give it a moment to finish.
    let lines: string[] = [];
    for (let i = 0; i < 50 && lines.length < 8; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      lines = existsSync(warmed) ? readFileSync(warmed, "utf8").trim().split("\n") : [];
    }
    expect(lines).toEqual([
      "http://dash.test/admin/pull-requests",
      "http://dash.test/api/pull-requests?warm=1",
      "http://dash.test/",
      "http://dash.test/production",
      "http://dash.test/api/production-console?part=core",
      "http://dash.test/api/production-console?part=queue",
      "http://dash.test/plans",
      "http://dash.test/api/plans"
    ]);
  });
  it("reports incomplete PR warming without rolling back successful health checks", () => {
    const { impl } = stubImpl(0);
    const curl = path.join(path.dirname(impl), "curl");
    writeFileSync(curl, '#!/usr/bin/env bash\nexit 22\n'); chmodSync(curl, 0o755);
    const result = runRestart(impl, "1", { ARCADIA_DASHBOARD_WARM: "1", ARCADIA_READY_DEADLINE: "1", ARCADIA_DASHBOARD_URL: "http://dash.test" });
    expect(result.status).toBe(0); expect(result.stdout).toContain("PR route warmup incomplete");
    expect(result.stderr).toContain("warning: PR route warmup incomplete");
  });

});

describe.skipIf(os.platform() !== "darwin")("scripts/services.sh restart implementation pin", () => {
  const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

  it("refuses, without running it, an implementation that is not the pinned one", () => {
    const { impl, calls } = stubImpl(0);
    const result = runRestart(impl, "1", { ARCADIA_RESTART_IMPL_SHA256: "0".repeat(64) });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("is not the pinned one");
    expect(readFileSync(calls, "utf8")).toBe("");
  });

  it("runs the implementation whose bytes match the pin", () => {
    const { impl, calls } = stubImpl(0);
    const result = runRestart(impl, "1", { ARCADIA_RESTART_IMPL_SHA256: sha(impl) });
    expect(result.status).toBe(0);
    expect(readFileSync(calls, "utf8").trim()).toBe("restart");
  });
});

describe("rehearsal-chain terminal Off pins the in-repo restart implementation", () => {
  it("pins the exact bytes of scripts/restart-services-impl.sh and passes the pin to scripts/services.sh", () => {
    const repo = path.resolve(__dirname, "..");
    const template = readFileSync(path.join(repo, "artifacts", "generated", "operator-scripts", "rehearsal-chain", "restore-terminal-off.sh"), "utf8");
    const digest = createHash("sha256").update(readFileSync(path.join(repo, "scripts", "restart-services-impl.sh"))).digest("hex");
    expect(template).toContain('RESTART_IMPL="$ARCADIA_REPO/scripts/restart-services-impl.sh"');
    expect(template).toContain(`RESTART_IMPL_SHA256="${digest}"`);
    expect(template).toContain('ARCADIA_RESTART_IMPL_SHA256="$RESTART_IMPL_SHA256"');
  });
});
