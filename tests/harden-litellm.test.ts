import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Fixture-only test for scripts/harden-litellm.sh: a fake config, compose file, plist and fake
// `security`, `docker`, `lsof`, `curl`, `launchctl`, `arcadia` and `sleep` first on PATH. It never
// touches the real LiteLLM files, keychain, Docker or launchd. The key below is synthetic.
const FAKE_KEY = "sk-proj-" + "FAKEFAKEFAKE0123456789abcdefXYZ";
const SCRIPT = path.resolve(import.meta.dirname, "../scripts/harden-litellm.sh");

const CONFIG = `model_list:
  - model_name: arcadia-cloud-text
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: "${FAKE_KEY}"
  - model_name: arcadia-default
    litellm_params:
      model: openai/local
      api_base: http://host.docker.internal:8000/v1
      api_key: local-placeholder
general_settings:
  master_key: sk-1234
`;

const COMPOSE = `services:
  db:
    image: postgres:16
    container_name: litellm-postgres
    ports:
      - "5432:5432"
  litellm:
    image: ghcr.io/berriai/litellm:main-stable
    container_name: litellm-proxy
    ports:
      - "4000:4000"
    volumes:
      - ./litellm_config.docker.yaml:/app/config.yaml
    environment:
      - DATABASE_URL=postgresql://u:p@db:5432/litellm
`;

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.litellm.proxy</string>
<key>ProgramArguments</key><array><string>/usr/local/bin/docker</string><string>compose</string><string>up</string></array>
</dict></plist>
`;

const FAKES: Record<string, string> = {
  security: `#!/bin/bash
echo "$@" >> "$FAKE/security.argv"
case "$1" in
  -i) cat > "$FAKE/security.stdin"; sed -n 's/.* -w "\\(.*\\)"$/\\1/p' "$FAKE/security.stdin" | head -n 1 > "$FAKE/kc" ;;
  find-generic-password) [ -s "$FAKE/kc" ] || exit 44; case " $* " in *" -w "*) cat "$FAKE/kc" ;; esac ;;
esac
`,
  docker: `#!/bin/bash
echo "docker $*" >> "$FAKE/docker.log"
`,
  launchctl: `#!/bin/bash
echo "launchctl $*" >> "$FAKE/launchctl.log"
`,
  curl: `#!/bin/bash
exit 0
`,
  sleep: `#!/bin/bash
exit 0
`,
  arcadia: `#!/bin/bash
printf 'Managed production\\n  %s\\n  Observed: now\\n' "\${FAKE_PRODUCTION:-Inactive}"
`,
  lsof: `#!/bin/bash
if [ -n "\${FAKE_LSOF_WIDE:-}" ] || ! grep -q '127.0.0.1:4000' "$FAKE_COMPOSE"; then echo 'n*:4000'; else echo 'n127.0.0.1:4000'; fi
`,
};

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "harden-litellm-"));
  temporary.push(root);
  const bin = path.join(root, "bin");
  const dir = path.join(root, "litellm-database");
  const fake = path.join(root, "fake");
  for (const d of [bin, dir, fake]) mkdirSync(d);
  for (const [name, body] of Object.entries(FAKES)) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const files = {
    config: path.join(dir, "litellm_config.docker.yaml"),
    compose: path.join(dir, "docker-compose.yml"),
    plist: path.join(root, "com.litellm.proxy.plist"),
  };
  writeFileSync(files.config, CONFIG);
  writeFileSync(files.compose, COMPOSE);
  writeFileSync(files.plist, PLIST.replace("/usr/local/bin/docker", path.join(bin, "docker")));
  const run = (args: string[], env: Record<string, string> = {}) => {
    const result = spawnSync(
      "bash",
      [SCRIPT, "--litellm-dir", dir, "--plist", files.plist, ...args],
      { encoding: "utf8", env: { ...process.env, ...env, PATH: `${bin}:${process.env.PATH}`, FAKE: fake, FAKE_COMPOSE: files.compose, HOME: root } },
    );
    return { status: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
  };
  const read = (file: string) => readFileSync(file, "utf8");
  const backups = () => readdirSync(dir).filter((n) => n.includes(".bak."));
  return { root, dir, fake, files, run, read, backups };
}

describe("harden-litellm.sh against a fake installation", () => {
  it("--help works and a budget is mandatory", () => {
    const f = fixture();
    expect(f.run(["--help"]).out).toContain("--budget-usd");
    const refused = f.run([]);
    expect(refused.status).toBe(2);
    expect(refused.out).toContain("no default budget");
    expect(f.run(["--budget-usd", "0"]).status).toBe(2);
  });

  it("dry run prints the plan and changes nothing", () => {
    const f = fixture();
    const result = f.run(["--budget-usd", "25"]);
    expect(result.status).toBe(0);
    expect(result.out).toContain("DRY RUN");
    expect(result.out).toContain("bind host port 4000 to 127.0.0.1");
    expect(result.out).toContain("max_budget 25");
    expect(result.out).toContain("os.environ/OPENAI_API_KEY");
    expect(result.out).toContain("advisory: master_key");
    expect(result.out).not.toContain(FAKE_KEY);
    expect(f.read(f.files.config)).toBe(CONFIG);
    expect(f.read(f.files.compose)).toBe(COMPOSE);
    expect(f.backups()).toEqual([]);
    expect(existsSync(path.join(f.fake, "security.stdin"))).toBe(false);
    expect(existsSync(path.join(f.fake, "launchctl.log"))).toBe(false);
  });

  it("applies, keeps the key out of output and argv, verifies, and is idempotent", () => {
    const f = fixture();
    const first = f.run(["--budget-usd", "25", "--apply"]);
    expect(first.out).not.toContain("VERIFY FAIL");
    expect(first.status).toBe(0);
    expect(first.out).toContain("verify ok: listening only on 127.0.0.1:4000");
    expect(first.out).toContain("restore (one line):");
    expect(first.out).not.toContain(FAKE_KEY);

    const config = f.read(f.files.config);
    expect(config).not.toContain(FAKE_KEY);
    expect(config).toContain("api_key: os.environ/OPENAI_API_KEY");
    expect(config).toContain("api_key: local-placeholder");
    expect(config).toMatch(/litellm_settings:\n {2}max_budget: 25\n {2}budget_duration: 30d/);
    const compose = f.read(f.files.compose);
    expect(compose).toContain('- "127.0.0.1:4000:4000"');
    expect(compose).toContain('"5432:5432"');
    expect(compose).toMatch(/- DATABASE_URL=.*\n {6}- OPENAI_API_KEY\n/);
    const launcher = f.read(path.join(f.dir, "start-litellm.sh"));
    expect(launcher).toContain("find-generic-password");
    expect(launcher).not.toContain(FAKE_KEY);
    expect(f.read(f.files.plist)).toContain("start-litellm.sh");

    // the key travelled on stdin only
    expect(f.read(path.join(f.fake, "security.argv"))).not.toContain(FAKE_KEY);
    expect(f.read(path.join(f.fake, "security.stdin"))).toContain(FAKE_KEY);
    for (const name of readdirSync(f.fake)) {
      if (["security.stdin", "kc"].includes(name)) continue;
      expect(f.read(path.join(f.fake, name))).not.toContain(FAKE_KEY);
    }

    const backups = f.backups();
    expect(backups.length).toBe(2);
    for (const b of backups) expect(statSync(path.join(f.dir, b)).mode & 0o777).toBe(0o600);

    const restarts = f.read(path.join(f.fake, "launchctl.log"));
    const second = f.run(["--budget-usd", "25", "--apply"]);
    expect(second.status).toBe(0);
    expect(second.out).toContain("no changes needed");
    expect(f.backups().length).toBe(2);
    expect(f.read(path.join(f.fake, "launchctl.log"))).toBe(restarts);

    // the printed one-line restore command puts the originals back
    const line = first.stdout.split("restore (one line):\n")[1].split("\n")[0];
    const restored = spawnSync("bash", ["-c", line], { encoding: "utf8", env: { ...process.env, PATH: `${path.join(f.root, "bin")}:${process.env.PATH}`, FAKE: f.fake } });
    expect(restored.status).toBe(0);
    expect(f.read(f.files.config)).toBe(CONFIG);
    expect(f.read(f.files.compose)).toBe(COMPOSE);
  });

  it("fails verification when the listener is still on every interface", () => {
    const f = fixture();
    const result = f.run(["--budget-usd", "25", "--apply"], { FAKE_LSOF_WIDE: "1" });
    expect(result.status).toBe(4);
    expect(result.out).toContain("VERIFY FAIL: listeners on 4000 are not only 127.0.0.1:4000");
  });

  it("defers the restart while production is Active, changing nothing", () => {
    const f = fixture();
    const result = f.run(["--budget-usd", "25", "--apply"], { FAKE_PRODUCTION: "Active · run 7" });
    expect(result.status).toBe(3);
    expect(f.read(f.files.config)).toBe(CONFIG);
    expect(f.backups()).toEqual([]);
  });

  it("refuses a literal key in a form it will not rewrite, before any change", () => {
    const f = fixture();
    writeFileSync(f.files.config, CONFIG + "extra:\n  litellm_params: {api_key: " + FAKE_KEY + "}\n");
    const result = f.run(["--budget-usd", "25", "--apply"]);
    expect(result.status).toBe(3);
    expect(f.backups()).toEqual([]);
    expect(result.out).not.toContain(FAKE_KEY);
  });

  it("refuses a compose file it cannot understand", () => {
    const f = fixture();
    writeFileSync(f.files.compose, "services:\n  other:\n    image: x\n");
    const result = f.run(["--budget-usd", "25", "--apply"]);
    expect(result.status).toBe(3);
    expect(f.read(f.files.config)).toBe(CONFIG);
  });
});
