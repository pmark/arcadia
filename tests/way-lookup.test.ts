import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { renderWayLookupSuccess, runWayLookupCommand } from "../src/commands/wayLookup.js";
import {
  isRuleBearing,
  corpusPaths,
  loadPassages,
  lookup,
  readCorpusFile,
  resolveWayRoot,
  slugify,
  sourceClassOf,
  splitDocument,
  splitPassages,
  buildIndex,
  stem,
  tokenize
} from "../src/way/lookup.js";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "arcadia-way-lookup-"));
  roots.push(dir);
  return dir;
}

function put(root: string, relative: string, content: string | Buffer): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Everything but timing, which is the only field allowed to vary between runs. */
function withoutTiming<T extends { elapsedMs: number }>(value: T): Omit<T, "elapsedMs"> {
  const { elapsedMs: _elapsed, ...rest } = value;
  return rest;
}

describe("passage splitting", () => {
  it("splits at ## and ### only, keeps the preamble with the title, and addresses by GitHub slug", () => {
    const passages = splitPassages(
      "docs/x.md",
      ["---", "name: x", "---", "# The Title", "", "Intro text.", "", "## First thing", "alpha", "", "### Sub part", "beta", "", "#### Deep", "gamma", "", "## Second `thing`!", "delta"].join("\n")
    );
    expect(passages.map((p) => p.address)).toEqual(["docs/x.md#the-title", "docs/x.md#first-thing", "docs/x.md#sub-part", "docs/x.md#second-thing"]);
    expect(passages[0].heading).toEqual(["The Title"]);
    expect(passages[0].body).toContain("Intro text.");
    expect(passages[0].body).not.toContain("# The Title");
    expect(passages[2].heading).toEqual(["The Title", "First thing", "Sub part"]);
    expect(passages[2].body).toContain("#### Deep");
    expect(passages[2].sha).toMatch(/^[0-9a-f]{12}$/);
  });

  it("maps each body line to its source line", () => {
    const text = ["# T", "", "## A", "", "one", "two", "", "## B", "three"].join("\n");
    const [a, b] = splitPassages("a.md", text);
    expect(a.lines).toEqual([5, 6]);
    expect(b.lines).toEqual([9]);
  });

  it("ignores headings inside code fences, including an unterminated one", () => {
    const closed = splitPassages("a.md", ["## Real", "```sh", "## not a heading", "```", "tail"].join("\n"));
    expect(closed.map((p) => p.address)).toEqual(["a.md#real"]);
    const open = splitPassages("a.md", ["## Real", "text", "```", "## still code", "### also code"].join("\n"));
    expect(open).toHaveLength(1);
    expect(open[0].body).toContain("### also code");
    const tilde = splitPassages("a.md", ["## Real", "~~~~", "```", "## nope", "~~~~", "## Next", "x"].join("\n"));
    expect(tilde.map((p) => p.address)).toEqual(["a.md#real", "a.md#next"]);
  });

  it("numbers duplicate headings the way GitHub does", () => {
    const passages = splitPassages("a.md", ["## Same", "one", "## Same", "two", "## Same", "three"].join("\n"));
    expect(passages.map((p) => p.address)).toEqual(["a.md#same", "a.md#same-1", "a.md#same-2"]);
  });

  it("returns nothing for a heading-only file and for empty input", () => {
    expect(splitPassages("a.md", "## One\n## Two\n### Three\n")).toEqual([]);
    expect(splitPassages("a.md", "")).toEqual([]);
    expect(splitPassages("a.md", "\n\n   \n")).toEqual([]);
  });

  it("slugifies like GitHub", () => {
    expect(slugify("Answering Decisions: letters, and when it is not answerable")).toBe("answering-decisions-letters-and-when-it-is-not-answerable");
    expect(slugify("[Link](http://x) and `code`")).toBe("link-and-code");
    expect(slugify("!!!")).toBe("section");
  });

  it("leaves out text inside <details> and sections that call themselves superseded, but keeps their slugs", () => {
    const text = [
      "# Doc",
      "## Current view",
      "now",
      "<details>",
      "<summary>Old</summary>",
      "## Current view",
      "old copy",
      "</details>",
      "## Current view",
      "second visible duplicate",
      "## Historical answer, 2026-10-17",
      "old answer",
      "### Run record",
      "old detail",
      "## Live section",
      "live"
    ].join("\n");
    const { passages, skipped } = splitDocument("a.md", text);
    expect(passages.map((p) => p.address)).toEqual(["a.md#current-view", "a.md#current-view-2", "a.md#live-section"]);
    expect(passages.map((p) => p.body)).toEqual(["now", "second visible duplicate", "live"]);
    expect(skipped).toBe(3);
  });
});

describe("<details> handling", () => {
  it("does not treat a mention of the tag as a block", () => {
    const text = ["## A", "Use `<details>` to collapse text, or write </details> by hand.", "still visible", "## B", "b text"].join("\n");
    const { passages, skipped } = splitDocument("a.md", text);
    expect(passages.map((p) => p.address)).toEqual(["a.md#a", "a.md#b"]);
    expect(passages[0].body).toContain("Use `<details>` to collapse text");
    expect(passages[0].body).toContain("still visible");
    expect(skipped).toBe(0);
  });

  it("ignores a tag at the start of a line inside a code fence", () => {
    const text = ["## A", "```html", "<details>", "<summary>x</summary>", "```", "after the fence", "## B", "b text"].join("\n");
    const { passages } = splitDocument("a.md", text);
    expect(passages.map((p) => p.address)).toEqual(["a.md#a", "a.md#b"]);
    expect(passages[0].body).toContain("after the fence");
  });

  it("does not let an unterminated block hide the rest of the file, and warns", () => {
    const text = ["## A", "a text", "<details>", "<summary>never closed</summary>", "## B", "b text", "## C", "c text"].join("\n");
    const { passages, skipped, warnings } = splitDocument("a.md", text);
    expect(passages.map((p) => p.address)).toEqual(["a.md#a", "a.md#b", "a.md#c"]);
    expect(skipped).toBe(0);
    expect(warnings).toEqual([expect.stringContaining("unterminated")]);
  });

  it("returns to the visible section for text after the close of a block that held headings", () => {
    const text = ["## Current", "before", "<details>", "<summary>Old</summary>", "## Old copy", "old text", "</details>", "after the block", "## Next", "next text"].join("\n");
    const { passages, skipped } = splitDocument("a.md", text);
    expect(passages.map((p) => p.address)).toEqual(["a.md#current", "a.md#next"]);
    expect(passages[0].body).toBe("before\nafter the block");
    expect(passages[0].lines).toEqual([2, 8]);
    expect(skipped).toBe(1);
  });

  it("leaves docs/COMMANDS.md whole although it mentions the tag in backticks", () => {
    const { passages } = loadPassages(repoRoot);
    const commands = passages.filter((p) => p.path === "docs/COMMANDS.md");
    expect(commands.some((p) => p.address.startsWith("docs/COMMANDS.md#assess-a-candidate-prs-blast-radius-before-merge"))).toBe(true);
    const result = lookup(repoRoot, "assess a candidate PR's blast radius before merge", { limit: 3 });
    expect(result.results.map((hit) => hit.address)).toContain("docs/COMMANDS.md#assess-a-candidate-prs-blast-radius-before-merge");
  });
});

describe("large files", () => {
  it("splits a 3.9 MB file of every awkward shape in linear time", () => {
    const shapes: Record<string, string> = {
      "one paragraph of sentences": `## S\n${"A sentence here. ".repeat(3_900_000 / 17)}`,
      "one huge list": `## L\n${"- item one. item two.\n".repeat(3_900_000 / 22)}`,
      "many small paragraphs": `## P\n${"para text\n\n".repeat(3_900_000 / 11)}`,
      "many headings": "## H\nbody\n".repeat(3_900_000 / 11)
    };
    for (const [name, text] of Object.entries(shapes)) {
      const started = Date.now();
      const passages = splitPassages("big.md", text);
      const index = buildIndex(passages, 1);
      expect(index.chunks.length, name).toBeGreaterThan(0);
      expect(Date.now() - started, name).toBeLessThan(20_000);
    }
  }, 120_000);
});

describe("tokens", () => {
  it("equates inflections and drops stopwords", () => {
    expect(stem("stopping")).toBe(stem("stop"));
    expect(stem("stopped")).toBe(stem("stop"));
    expect(stem("decisions")).toBe(stem("decision"));
    expect(stem("merging")).toBe(stem("merged"));
    expect(tokenize("What is the Decision?")).toEqual([stem("decision")]);
  });
});

describe("corpus reading", () => {
  it("skips missing files silently and finds the fixed list, guidance files and skills", () => {
    const root = tempRoot();
    put(root, "CONSTITUTION.md", "## A\nx");
    put(root, "docs/agent-guidance/b.md", "## B\nx");
    put(root, "docs/agent-guidance/ignored.txt", "## C\nx");
    put(root, ".agents/skills/s/SKILL.md", "## S\nx");
    put(root, ".agents/skills/empty/README.md", "## R\nx");
    expect(corpusPaths(root).filter((file) => ["CONSTITUTION.md", "docs/agent-guidance/b.md", ".agents/skills/s/SKILL.md"].includes(file))).toHaveLength(3);
    const { passages, filesScanned } = loadPassages(root);
    expect(filesScanned).toBe(3);
    expect(passages.map((p) => p.address).sort()).toEqual([".agents/skills/s/SKILL.md#s", "CONSTITUTION.md#a", "docs/agent-guidance/b.md#b"]);
    expect(lookup(tempRoot(), "anything at all").matched).toBe(false);
  });

  it("reads non-UTF-8 bytes without failing", () => {
    const root = tempRoot();
    put(root, "CONSTITUTION.md", Buffer.concat([Buffer.from("## Bytes\nbefore "), Buffer.from([0xff, 0xfe, 0xc3, 0x28]), Buffer.from(" after \u0000 nul\n")]));
    const [passage] = loadPassages(root).passages;
    expect(passage.body).toContain("before");
    expect(passage.body).not.toContain("\u0000");
  });

  it("does not follow a file symlink or a directory symlink that leaves the root", () => {
    const outside = tempRoot();
    put(outside, "secret.md", "## Secret\nthe outside text");
    put(outside, "guidance/leak.md", "## Leak\nleaked text");
    const root = tempRoot();
    put(root, "CONSTITUTION.md", "## Inside\nreal text");
    symlinkSync(path.join(outside, "secret.md"), path.join(root, "AGENTS.md"));
    mkdirSync(path.join(root, "docs"), { recursive: true });
    symlinkSync(path.join(outside, "guidance"), path.join(root, "docs", "agent-guidance"));
    expect(readCorpusFile(root, "AGENTS.md")).toBeNull();
    expect(readCorpusFile(root, "docs/agent-guidance/leak.md")).toBeNull();
    const { passages } = loadPassages(root);
    expect(passages.map((p) => p.address)).toEqual(["CONSTITUTION.md#inside"]);
    expect(JSON.stringify(lookup(root, "outside leaked secret text"))).not.toContain("leaked text");
  });
});

describe("way root", () => {
  it("prefers the enclosing Project when it holds the guidance index, then the package, then null", () => {
    const project = tempRoot();
    const pkg = tempRoot();
    const bare = tempRoot();
    put(pkg, "docs/agent-guidance/index.json", "{}");
    put(pkg, "dist/src/way/lookup.js", "");
    const moduleUrl = pathToFileURL(path.join(pkg, "dist/src/way/lookup.js")).href;
    expect(resolveWayRoot({ projectRoot: project, moduleUrl })).toEqual({ root: pkg, source: "package" });
    put(project, "docs/agent-guidance/index.json", "{}");
    expect(resolveWayRoot({ projectRoot: project, moduleUrl })).toEqual({ root: project, source: "project" });
    put(bare, "dist/src/way/lookup.js", "");
    expect(resolveWayRoot({ projectRoot: null, moduleUrl: pathToFileURL(path.join(bare, "dist/src/way/lookup.js")).href })).toBeNull();
  });
});

describe("lookup on a small corpus", () => {
  function corpus(): string {
    const root = tempRoot();
    put(root, "docs/agent-guidance/index.json", JSON.stringify({ entries: [{ path: "docs/agent-guidance/pull-requests.md", trigger: "merge, ci" }] }));
    put(root, "docs/agent-guidance/pull-requests.md", "# Pull requests\n\n## Merge on green\n\nAn agent merges a pull request when review is clean and checks are green.\n\n## Notifications\n\nSend one ping when a pull request opens.\n");
    put(root, "docs/agent-guidance/learning.md", "# Learning\n\n## Capture a lesson\n\nRun the learn command to record a lesson about a mistake.\n");
    put(root, "docs/notes-to-self.md", "# Notes\n\n## Vitest hangs\n\nkeys: vitest, hang, timeout\n\nRun one file with the --testTimeout flag.\n");
    return root;
  }

  it("returns the passage that answers, with address, heading, sha, line and source class", () => {
    const result = lookup(corpus(), "When may an agent merge a pull request?");
    expect(result.matched).toBe(true);
    expect(result.results[0]).toMatchObject({
      address: "docs/agent-guidance/pull-requests.md#merge-on-green",
      heading: "Pull requests > Merge on green",
      truncated: false,
      sourceClass: "canonical",
      line: 5
    });
    expect(result.results[0].sha).toMatch(/^[0-9a-f]{12}$/);
    expect(result.passagesScanned).toBe(4);
  });

  it("tags lessons as hot_cache, and matches keys: lines", () => {
    const result = lookup(corpus(), "vitest hang timeout");
    expect(result.results[0].address).toBe("docs/notes-to-self.md#vitest-hangs");
    expect(result.results[0].sourceClass).toBe("hot_cache");
    expect(sourceClassOf("START_HERE.md")).toBe("operator_guide");
    expect(sourceClassOf("CONSTITUTION.md")).toBe("canonical");
    expect(sourceClassOf(".agents/skills/x/SKILL.md")).toBe("canonical");
  });

  it("is byte-identical between runs apart from elapsedMs", () => {
    const root = corpus();
    const first = JSON.stringify(withoutTiming(lookup(root, "capture a lesson about a mistake")));
    const second = JSON.stringify(withoutTiming(lookup(root, "capture a lesson about a mistake")));
    expect(first).toBe(second);
  });

  it("returns the address but no excerpt for a zero budget, and never exceeds a budget", () => {
    const root = corpus();
    const zero = lookup(root, "When may an agent merge a pull request?", { budget: 0 });
    expect(zero.results[0]).toMatchObject({ excerpt: "", truncated: true });
    for (const budget of [1, 5, 20, 60, 1500]) {
      const result = lookup(root, "When may an agent merge a pull request?", { budget });
      expect(result.excerptBytes).toBeLessThanOrEqual(budget);
      for (const hit of result.results) expect(Buffer.byteLength(hit.excerpt)).toBeLessThanOrEqual(budget);
    }
  });

  it("returns a rule with its exception whole when it fits and marks the fragment when it does not", () => {
    const root = tempRoot();
    const rule = `Deploys are a hard stop. ${"Each deploy needs a recorded approval from the owner of the service. ".repeat(18)}Unless the change is a documented rollback, in which case the on-call engineer may proceed.`;
    put(root, "docs/agent-guidance/deploys.md", `# Deploys\n\n## Deploy approval\n\n${rule}\n`);
    put(root, "docs/agent-guidance/other.md", "# Other\n\n## Lunch\n\nThe kitchen opens at noon.\n\n## Parking\n\nPark behind the building.\n\n## Badges\n\nWear your badge.\n");
    const whole = lookup(root, "deploy approval owner service rollback", { budget: 3000 });
    expect(whole.matched).toBe(true);
    expect(whole.results[0]).toMatchObject({ truncated: false });
    expect(whole.results[0].excerpt).toContain("documented rollback");
    const small = lookup(root, "deploy approval owner service rollback", { budget: 300 });
    expect(small.results[0].truncated).toBe(true);
    expect(small.results[0].address).toBe("docs/agent-guidance/deploys.md#deploy-approval");
  });

  it("does not match when most of the question's words appear nowhere in the Way", () => {
    expect(lookup(corpus(), "merge zzqxv blorptastic frobnicate").matched).toBe(false);
    expect(lookup(corpus(), "merge pull request").matched).toBe(true);
  });

  it("does not claim an answer for empty, stopword-only, hostile or enormous questions", () => {
    const root = corpus();
    for (const question of ["", "   \n\t ", "what is the", "(((", "[a-z]+.*\\", "$(rm -rf /)", "''\"`${}<>|;&", "\u0000\u0001�"]) {
      const result = lookup(root, question);
      expect(result.matched).toBe(false);
      expect(result.results).toEqual([]);
    }
    const started = Date.now();
    const huge = lookup(root, `${"merge pull request ".repeat(1000)}${"x".repeat(1_000_000)}`);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(huge.warnings.join(" ")).toContain("cut to its first");
  });
});

describe("the command", () => {
  it("rejects an empty question and bad numbers instead of guessing", () => {
    expect(() => runWayLookupCommand({ question: "  " })).toThrow(/question/);
    for (const budget of ["-5", "-0", "1.5", "abc", "", "99999999999"]) expect(() => runWayLookupCommand({ question: "merge", budget })).toThrow(/--budget/);
    for (const limit of ["0", "-1", "21", "x"]) expect(() => runWayLookupCommand({ question: "merge", limit })).toThrow(/--limit/);
  });

  it("reports the root it read, and says plainly when the Way does not answer", () => {
    const answered = runWayLookupCommand({ question: "When may an agent merge a pull request?", limit: "1" });
    expect(answered.data.root).toBe(repoRoot);
    expect(answered.data.rootSource).toBe("project");
    const lines = renderWayLookupSuccess(answered);
    expect(lines[0]).toContain("closest passages by wording and may not answer");
    expect(lines[1]).toBe(`Way root: ${repoRoot} (the enclosing Project's guidance)`);
    expect(lines[3]).toMatch(/^\S+#\S+ \(line \d+, \w+/);
    const unanswered = runWayLookupCommand({ question: "xylophone repair schedule" });
    expect(unanswered.data.matched).toBe(false);
    expect(unanswered.data.results).toEqual([]);
    const text = renderWayLookupSuccess(unanswered).join("\n");
    expect(text).toContain("does not clearly answer");
    expect(text).toContain(`Way root: ${repoRoot}`);
    expect(text).not.toMatch(/\(line \d+/);
  });
});

describe("against the real guidance", () => {
  const offTopic = [
    "xylophone repair schedule",
    "recipe for sourdough bread",
    "what is the capital of France",
    "weather in Paris tomorrow",
    "best pizza topping",
    "how do I train a puppy",
    "quantum chromodynamics lattice simulation",
    "cheap flights to Tokyo in March",
    "guitar string replacement",
    "tax deductions for home office",
    "how to repot a cactus",
    "marathon training plan for beginners",
    "what is the plan for dinner",
    "repair the schedule of the buses",
    "install a kitchen faucet",
    "symphony orchestra tuning",
    "merge conflict in my sourdough starter"
  ];

  it("abstains on off-topic questions, including ones that borrow common Way words", () => {
    const confident = offTopic.filter((question) => lookup(repoRoot, question).matched);
    expect(confident).toEqual([]);
  });

  it("never lets a superseded copy outrank or stand beside the current one", () => {
    const { passages } = loadPassages(repoRoot);
    const readiness = passages.filter((p) => p.path === "docs/managed-production-readiness.md");
    const current = readiness.filter((p) => p.address.startsWith("docs/managed-production-readiness.md#operator-view-the-rovers-route-from-here"));
    expect(current.map((p) => p.address)).toEqual(["docs/managed-production-readiness.md#operator-view-the-rovers-route-from-here"]);
    expect(readiness.some((p) => /historical-answer|current-readiness-and-limits|preserved-earlier/.test(p.address) && !p.address.includes("preserved-earlier-derivation"))).toBe(false);
    const result = lookup(repoRoot, "operator view rover route from here", { limit: 10, budget: 100_000 });
    expect(result.supersededSkipped).toBeGreaterThan(0);
    const addresses = result.matched ? result.results.map((hit) => hit.address) : result.nearest.map((hit) => hit.address);
    expect(addresses.filter((address) => /operator-view-the-rovers-route-from-here-\d/.test(address))).toEqual([]);
    const source = readFileSync(path.join(repoRoot, "docs/managed-production-readiness.md"), "utf8").split("\n");
    for (const passage of readiness) {
      const heading = source[passage.lines[0] - 1] ?? "";
      expect(heading).not.toMatch(/<details|<summary/);
    }
  });

  it("never returns a fragment of rule-with-exception text as if it were complete", () => {
    const { passages } = loadPassages(repoRoot);
    const bodies = new Map(passages.map((p) => [p.address, p.body]));
    const ruleBearing = passages.filter((p) => isRuleBearing(p));
    expect(ruleBearing.length).toBeGreaterThan(20);
    expect(ruleBearing.some((p) => p.path === "CONSTITUTION.md")).toBe(true);
    const questions = [
      "can an agent merge a pull request on its own",
      "what is the exception to the approval boundaries",
      "when must an agent wait for the operator",
      "may agents spend money or use credentials",
      "unless the operator says otherwise what happens to a stale pointer",
      "what are the hard stops",
      "only when is a push allowed to reset review"
    ];
    let seen = 0;
    for (const question of questions) {
      for (const budget of [150, 600, 1500, 10_000]) {
        const { results } = lookup(repoRoot, question, { limit: 5, budget });
        for (const [position, hit] of results.entries()) {
          const passage = passages.find((p) => p.address === hit.address);
          if (!passage || !isRuleBearing(passage)) continue;
          seen += 1;
          const body = bodies.get(hit.address);
          expect(hit.truncated, `${question} @${budget} ${hit.address}`).toBe(hit.excerpt !== body);
          // The first result has the whole budget; later ones only what is left.
          if (position === 0 && Buffer.byteLength(passage.body) <= Math.min(budget, 4000)) expect(hit.excerpt, `${question} @${budget}`).toBe(body);
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("stays byte-identical between runs apart from elapsedMs", () => {
    const question = "How do I stop everything immediately?";
    expect(JSON.stringify(withoutTiming(lookup(repoRoot, question)))).toBe(JSON.stringify(withoutTiming(lookup(repoRoot, question))));
  });

  it("windows very large passages instead of returning them, and reports how large they get", () => {
    const result = lookup(repoRoot, "protect active coding work worktree safety states", { limit: 3 });
    expect(result.largestPassageBytes).toBeGreaterThan(20_000);
    expect(result.excerptBytes).toBeLessThanOrEqual(result.budget);
    for (const hit of result.results) if (hit.address.startsWith("START_HERE.md#protect-active-coding-work")) expect(hit.truncated).toBe(true);
  });

  it("measures the development fixture without treating it as a pass mark", () => {
    const rows = readFileSync(path.join(repoRoot, "tests/fixtures/way-lookup-golden.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; question: string; accept: string[]; gap?: string });
    expect(rows).toHaveLength(30);
    const known = new Set(loadPassages(repoRoot).passages.map((p) => p.address));
    const missed: string[] = [];
    const matchedButMissed: string[] = [];
    let accepted = 0;
    let matched = 0;
    for (const row of rows) {
      expect(row.accept.length).toBeGreaterThan(0);
      const result = lookup(repoRoot, row.question, { limit: 3, budget: 1_000_000 });
      const addresses = result.matched ? result.results.map((hit) => hit.address) : result.nearest.map((hit) => hit.address);
      // Structure that must hold whatever the ranking does.
      expect(result.matched ? result.nearest : result.results).toEqual([]);
      expect(addresses.length).toBeGreaterThan(0);
      for (const address of addresses) expect(known.has(address), address).toBe(true);
      const hit = addresses.some((address) => row.accept.some((prefix) => address.startsWith(prefix)));
      if (result.matched) matched += 1;
      if (hit) accepted += 1;
      else {
        missed.push(row.id);
        if (result.matched) matchedButMissed.push(row.id);
      }
    }
    expect(matched + rows.filter((row) => !lookup(repoRoot, row.question).matched).length).toBe(rows.length);
    console.info(
      `way lookup development fixture (contaminated; a measurement, not a pass mark): accepted material in top 3 for ${accepted}/${rows.length}; ` +
        `matched ${matched}/${rows.length}; matched but missed ${matchedButMissed.length} (${matchedButMissed.join(",")}); all missed ${missed.join(",")}`
    );
  });
});

describe("stop-production wording against the real guidance (Issue #2348)", () => {
  const productionOff = "START_HERE.md#managed-production-the-standing-authorization";
  /** The first address the lookup offers: the matched results when it answers, otherwise the nearest passages. */
  const first = (question: string): { matched: boolean; address: string | undefined } => {
    const result = lookup(repoRoot, question, { limit: 3, budget: 100_000 });
    return { matched: result.matched, address: (result.matched ? result.results : result.nearest)[0]?.address };
  };

  it.each([
    "how do I stop everything",
    "turn production off",
    "where is the off button",
    "stop everything",
    "turn off production",
    "what happens when I stop production"
  ])("returns the production Off guidance first for %j", (question) => {
    const top = first(question);
    expect(top.matched).toBe(true);
    expect(top.address).toBe(productionOff);
  });

  it.each(["before you stop", "how do I stop a session"])("keeps the session-ending passage first for the near-miss %j", (question) => {
    expect(first(question)).toEqual({ matched: true, address: "docs/agent-guidance/continuation.md#before-you-stop" });
  });

  // Recorded on main (7df775a17) before the change; these wordings must keep that first passage.
  const provider = "START_HERE.md#provider-capacity-gates-every-admission-unless-you-turn-the-gate-off";
  const mergeOnGreen = "docs/agent-guidance/pull-requests.md#merge-on-green";
  it.each([
    ["turn off notifications", { matched: false, address: provider }],
    ["how do I turn off the dashboard", { matched: true, address: provider }],
    ["turn off the gate", { matched: true, address: provider }],
    ["switch off discord", { matched: true, address: productionOff }],
    ["switch off auto merge", { matched: false, address: mergeOnGreen }],
    ["turn off auto-merge", { matched: false, address: mergeOnGreen }]
  ])("keeps the base first passage for non-production %j", (question, expected) => {
    expect(first(question)).toEqual(expected);
  });

  it("never offers the production Off guidance first for a question about ending a session", () => {
    expect(first("how do I end my session").address?.startsWith("START_HERE.md#managed-production")).toBe(false);
  });

  it("still says the Way does not clearly answer gibberish", () => {
    expect(first("asdfgh qwzx plork").matched).toBe(false);
  });
});
