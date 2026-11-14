import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const impl = path.resolve(__dirname, "..", "scripts", "restart-services-impl.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Runs the implementation's listener_pids against a fake `lsof -Fpn` listing. */
function listenerPids(listing: string): string[] {
  const root = mkdtempSync(path.join(os.tmpdir(), "arcadia-listener-pids-"));
  roots.push(root);
  const source = readFileSync(impl, "utf8");
  const fn = source.match(/^listener_pids\(\) \{[\s\S]*?^\}/m);
  if (!fn) throw new Error("listener_pids not found in restart-services-impl.sh");
  writeFileSync(path.join(root, "fn.sh"), `${fn[0]}\n`);
  writeFileSync(path.join(root, "listing"), listing);
  const lsof = path.join(root, "lsof");
  writeFileSync(lsof, `#!/usr/bin/env bash\ncat "${root}/listing"\n`);
  chmodSync(lsof, 0o755);
  const result = spawnSync("bash", ["-c", `source "${root}/fn.sh"; listener_pids 3020`], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
  });
  expect(result.status).toBe(0);
  return result.stdout.split("\n").filter(Boolean);
}

describe("restart-services-impl.sh listener_pids", () => {
  it("ignores a tailscale serve listener on the Tailnet address that proxies to loopback", () => {
    const listing = [
      "p729", "f12", "n100.66.244.44:3020", "f13", "n[fd7a:115c:a1e0::f53b:f42d]:3020",
      "p30087", "f20", "n127.0.0.1:3020",
    ].join("\n") + "\n";
    expect(listenerPids(listing)).toEqual(["30087"]);
  });

  it("still counts loopback and every-interface listeners as owners of the port", () => {
    const listing = ["p11", "f3", "n*:3020", "p12", "f4", "n[::1]:3020", "p13", "f5", "n[::]:3020", "p14", "f6", "n0.0.0.0:3020"].join("\n") + "\n";
    expect(listenerPids(listing)).toEqual(["11", "12", "13", "14"]);
  });

  it("returns nothing when nothing listens", () => {
    expect(listenerPids("")).toEqual([]);
  });
});
