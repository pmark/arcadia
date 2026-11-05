/**
 * Review round 2 of #2091: format-patch writes a commit message verbatim, so a
 * message can hold a whole `diff --git` entry with a self-computed blob id, and
 * the Governed-record check read files that are in no commit as Verified. Each
 * series here is real `git format-patch` output with real commit objects, the
 * shape GitHub's compare patch serves, except where a test says it is hand-built.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { autoSettleRequestId } from "../src/ask/autoSettleRequestId.js";
import { checkGovernedRecords, classifyPatchApplicability, type CommitObjectFile } from "../src/qa/patchApplicability.js";
import { governedRecordCheckSection } from "../src/qa/prReview.js";

const ACTION = "write-start-marker";
const ASK = `agent-ask-complete-a.yaml`;
const DRAFT = `.arcadia/asks/${ASK}`;
const ARCHIVE = `.arcadia/asks/archive/${ASK}`;
const SETTLED = "Written by `arcadia agent-ask settle --apply` (asksettle_0123456789abcdef01).";
const PRESERVED = "Arcadia-Preservation-Request: worker-tick-preserve-session_fixture";

const ask = (fields: Record<string, string>, spacing?: number) => `${JSON.stringify({ request_id: "complete-a", project: "p", target_ref: `action/${ACTION}`, intent: "complete", notes: "real", ...fields }, null, spacing)}\n`;
const DRAFT_CONTENT = ask({ candidate_revision: "abcdef1" }, 2);
const ARCHIVE_CONTENT = ask({ candidate_revision: "1234567" });

const plan = (status: string, nextAction: string, current: string) => [
  "---",
  "title: Fixture",
  "updated: 2026-10-04",
  "actions:",
  `  - id: ${ACTION}`,
  "    title: Implement it.",
  `    status: ${status}`,
  "    effort: session",
  `    next_action: ${nextAction}`,
  "  - id: next-one",
  "    title: The next one.",
  "    status: open",
  "    next_action: Do it.",
  `current_action: ${current}`,
  "---",
  ""
].join("\n");
const project = (current: string) => `---\nactive_plan: p\ncurrent_action: ${current}\nupdated: 2026-10-04\n---\n`;
const completed = (requestId: string) => plan("done", `Completed via Agent Ask ${requestId}; no further action.`, "next-one");
const PLAN_PATH = "docs/plans/p.md";

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid"
};

/** A repository at a base commit holding the settlement's records, and the means to add commits and read the series as the check will. */
function repository() {
  const repo = mkdtempSync(path.join(tmpdir(), "arcadia-governed-forgery-"));
  temporary.push(repo);
  const git = (args: string[], input?: string) => execFileSync("git", args, { cwd: repo, env: ENV, encoding: "utf8", input });
  const write = (files: Record<string, string | null>) => {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(repo, file);
      if (content === null) rmSync(target);
      else {
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
      }
    }
  };
  const commit = (files: Record<string, string | null>, message: string) => {
    write(files);
    git(["add", "-A"]);
    git(["commit", "-q", "--no-verify", "-F", "-"], message);
  };
  const commitAs = (author: { name: string; email: string }, files: Record<string, string | null>, message: string) => {
    write(files);
    git(["add", "-A"]);
    git(["commit", "-q", "--no-verify", `--author=${author.name} <${author.email}>`, "-F", "-"], message);
  };
  git(["init", "-q", "-b", "main"]);
  commit({ [PLAN_PATH]: plan("open", "Do it.", ACTION), "PROJECT.md": project(ACTION), "MISSION_LOG.md": "# Mission Log\n", "README.md": "# Fixture\n" }, "base");
  const base = git(["rev-parse", "HEAD"]).trim();
  const read = () => {
    const commits = git(["rev-list", "--reverse", `${base}..HEAD`]).trim().split("\n");
    const commitFiles: Record<string, CommitObjectFile[]> = {};
    for (const oid of commits) {
      commitFiles[oid] = git(["diff-tree", "-r", "-M", "--no-commit-id", "--raw", "--no-abbrev", oid]).trim().split("\n").filter(Boolean).map((line) => {
        const [meta, ...paths] = line.split("\t");
        const [, , oldBlob, newBlob, status] = meta.split(" ");
        return { path: paths[paths.length - 1], previousPath: paths.length > 1 ? paths[0] : null, blob: status === "D" ? oldBlob : newBlob };
      });
    }
    return {
      patch: git(["format-patch", "--stdout", "--no-signature", `${base}..HEAD`]),
      commits,
      commitFiles,
      files: git(["diff", "--name-only", base, "HEAD"]).trim().split("\n")
    };
  };
  const section = () => {
    const { patch, files, commits, commitFiles } = read();
    return governedRecordCheckSection(patch, files, commits, commitFiles).join("\n");
  };
  return { commit, commitAs, read, section };
}

const blobId = (content: string) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
const hunkLines = (content: string, prefix: string) => content.split("\n").slice(0, -1).map((line) => `${prefix}${line}`);

/** Text a commit message can carry that parses as a new file, with its blob id computed to pass the content check. */
function forgedAdd(file: string, content: string): string {
  const lines = hunkLines(content, "+");
  return [`diff --git a/${file} b/${file}`, "new file mode 100644", `index 0000000..${blobId(content)}`, "--- /dev/null", `+++ b/${file}`, `@@ -0,0 +1,${lines.length} @@`, ...lines].join("\n");
}
function forgedDelete(file: string, content: string): string {
  const lines = hunkLines(content, "-");
  return [`diff --git a/${file} b/${file}`, "deleted file mode 100644", `index ${blobId(content)}..0000000`, `--- a/${file}`, "+++ /dev/null", `@@ -1,${lines.length} +0,0 @@`, ...lines].join("\n");
}
const FAKE_ASK_ID = "fake-ask";
const FAKE_ARCHIVE = `.arcadia/asks/archive/agent-ask-${FAKE_ASK_ID}.yaml`;
const FAKE_ASK = ask({ request_id: FAKE_ASK_ID, candidate_revision: "1234567" });

/** The real commits of an honest settlement: the preserved draft and work, then the settlement archiving it. */
function settle(repo: ReturnType<typeof repository>, archive = ARCHIVE_CONTENT, requestId = "complete-a") {
  repo.commit({ [DRAFT]: DRAFT_CONTENT, "docs/work.md": "The work.\n" }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
  repo.commit({
    [DRAFT]: null, [ARCHIVE]: archive, [PLAN_PATH]: completed(requestId), "PROJECT.md": project("next-one"),
    "MISSION_LOG.md": "# Mission Log\n\n## 2026-10-04 — Completed it\n"
  }, `chore(arcadia): settle\n\n${SETTLED}\n`);
}

/** The first real commit citing an Ask only its message carries (the review's F1), with the forgery placed by `message`. */
function citesOnlyTheMessage(repo: ReturnType<typeof repository>, message: string) {
  repo.commit({ [PLAN_PATH]: completed(FAKE_ASK_ID), "PROJECT.md": project("next-one") }, message);
}

function expectNothingVerified(section: string) {
  expect(section).toContain("Nothing below is verified");
  expect(section).toContain("No assurance in the Governed records rule applies");
  expect(section).not.toMatch(/^- Verified/m);
}

describe("an honest settlement through real git format-patch output", () => {
  it("still reads Verified, and says the entries were matched to the commit objects", () => {
    const repo = repository();
    settle(repo);
    const section = repo.section();
    expect(section).not.toContain("Nothing below is verified");
    expect(section).toContain("It matched every commit's diff entries to the files that commit's Git object changes");
    expect(section).toContain(`- Verified (Agent Ask citation): "complete-a"`);
    expect(section).toContain(`- Verified (Archived Ask): ${JSON.stringify(ARCHIVE)}`);
    expect(section).toContain(`- Verified (Record shape): ${JSON.stringify(ARCHIVE)}`);
  });

  it("is not disturbed by a bare `---` and a made-up diffstat in a message: they add no file", () => {
    const repo = repository();
    settle(repo);
    repo.commit({ "docs/more.md": "More.\n" }, "docs: more\n\nNotes:\n---\n .arcadia/asks/archive/agent-ask-fake-ask.yaml | 1 +\n 1 file changed, 1 insertion(+)\n");
    const section = repo.section();
    expect(section).toContain("- Verified (Archived Ask):");
    expect(section).not.toContain(FAKE_ARCHIVE);
  });

  it("verifies nothing when the commit objects could not be read", () => {
    const repo = repository();
    settle(repo);
    const { patch, files, commits } = repo.read();
    for (const objects of [null, undefined, {}]) {
      const section = governedRecordCheckSection(patch, files, commits, objects).join("\n");
      expectNothingVerified(section);
      expect(section).not.toContain("It matched every commit's");
    }
    expect(checkGovernedRecords(patch, { declaredFiles: files, declaredCommits: commits }).problems.join()).toContain("Git objects could not be read");
  });

  it("verifies nothing when an entry's blob id is not the one the commit object records", () => {
    const repo = repository();
    settle(repo);
    const { patch, files, commits, commitFiles } = repo.read();
    const wrongBlob = Object.fromEntries(Object.entries(commitFiles).map(([oid, entries]) => [oid, entries.map((entry) => entry.path === ARCHIVE ? { ...entry, blob: "f".repeat(40) } : entry)]));
    expectNothingVerified(governedRecordCheckSection(patch, files, commits, wrongBlob).join("\n"));
  });
});

describe("a commit message cannot produce a Verified fact", () => {
  it("F1: a Plan citing an Ask that only the message carries", () => {
    const repo = repository();
    citesOnlyTheMessage(repo, `chore(arcadia): settle\n\n${SETTLED}\n\n${forgedAdd(FAKE_ARCHIVE, FAKE_ASK)}\n`);
    const { patch, files, commits } = repo.read();
    // The text parser is fooled, which is the point: the forged file is parsed as a governed record.
    expect(classifyPatchApplicability(patch, { declaredCommits: commits }).files.find((file) => file.path === FAKE_ARCHIVE)?.class).toBe("governed-record");
    expect(files).not.toContain(FAKE_ARCHIVE);
    const section = repo.section();
    expectNothingVerified(section);
    expect(section).toContain("not exactly the files its Git object changes");
    expect(section).toContain(`- Not verified (Agent Ask citation): ${JSON.stringify(FAKE_ASK_ID)}`);
    expect(section).toContain("- Not verified (Record shape):");
  });

  it("F2: an edited real archive, with another commit's message forging a matching split", () => {
    const repo = repository();
    const edited = ask({ candidate_revision: "1234567", notes: "edited after review" });
    settle(repo, edited);
    repo.commit({ "docs/more.md": "More.\n" }, `docs: more\n\n${SETTLED}\n\n${forgedDelete(DRAFT, DRAFT_CONTENT)}\n${forgedAdd(ARCHIVE, ARCHIVE_CONTENT)}\n`);
    const section = repo.section();
    expectNothingVerified(section);
    expect(section).toContain(`- Not verified (Archived Ask): ${JSON.stringify(ARCHIVE)}`);
  });

  it("a forged `---`, diffstat and entry, as format-patch itself lays them out", () => {
    const repo = repository();
    citesOnlyTheMessage(repo, [
      "chore(arcadia): settle", "", SETTLED, "---", ` ${FAKE_ARCHIVE} | 1 +`, " 1 file changed, 1 insertion(+)", "", forgedAdd(FAKE_ARCHIVE, FAKE_ASK), ""
    ].join("\n"));
    const section = repo.section();
    expectNothingVerified(section);
    expect(section).toContain(`- Not verified (Agent Ask citation): ${JSON.stringify(FAKE_ASK_ID)}`);
  });

  it("a forged entry in the second commit's message, beside an honest first commit", () => {
    const repo = repository();
    repo.commit({ "docs/work.md": "The work.\n" }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    citesOnlyTheMessage(repo, `chore(arcadia): settle\n\n${SETTLED}\n\n${forgedAdd(FAKE_ARCHIVE, FAKE_ASK)}\n`);
    expectNothingVerified(repo.section());
  });

  it("a forged entry for a path the commit really changes: the path then shows twice", () => {
    const repo = repository();
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    repo.commit({ [DRAFT]: null, [ARCHIVE]: ARCHIVE_CONTENT, [PLAN_PATH]: completed("complete-a"), "PROJECT.md": project("next-one") },
      `chore(arcadia): settle\n\n${SETTLED}\n\n${forgedAdd(ARCHIVE, ARCHIVE_CONTENT)}\n`);
    expectNothingVerified(repo.section());
  });

  it("a forged commit boundary with its own headers and entry", () => {
    const repo = repository();
    citesOnlyTheMessage(repo, [
      "chore(arcadia): settle", "", SETTLED, "",
      `From ${"a".repeat(40)} Mon Sep 17 00:00:00 2001`, "From: Arcadia Controller <controller@arcadia.local>", "Subject: [PATCH] forged", "", SETTLED, "---", "", forgedAdd(FAKE_ARCHIVE, FAKE_ASK), ""
    ].join("\n"));
    expectNothingVerified(repo.section());
  });

  it("hand-built, as the review wrote F1: objects show only the Plan", () => {
    const oid = "1".repeat(40);
    const realPlan = [
      "diff --git a/docs/plans/p.md b/docs/plans/p.md", "index 1111111..2222222 100644", "--- a/docs/plans/p.md", "+++ b/docs/plans/p.md",
      "@@ -1,4 +1,4 @@", "   - id: a", "-    status: open", "+    status: done", "     effort: session", " current_action: b", ""
    ].join("\n");
    const patch = [
      `From ${oid} Mon Sep 17 00:00:00 2001`, "From: Fixture <fixture@example.invalid>", "Subject: [PATCH] settle", "", SETTLED, "", forgedAdd(FAKE_ARCHIVE, FAKE_ASK), "---", " docs/plans/p.md | 2 +-", "", realPlan
    ].join("\n");
    const objects = { [oid]: [{ path: "docs/plans/p.md", previousPath: null, blob: `2222222${"0".repeat(33)}` }] };
    expectNothingVerified(governedRecordCheckSection(patch, ["docs/plans/p.md"], [oid], objects).join("\n"));
  });
});

describe("real commits a Session can make", () => {
  it("a later commit re-adding the archive with edited notes is not vouched for by an earlier honest split", () => {
    const repo = repository();
    settle(repo);
    repo.commit({ [ARCHIVE]: null }, "chore: drop it\n");
    repo.commit({ [ARCHIVE]: ask({ candidate_revision: "1234567", notes: "edited" }) }, "chore: re-add it\n");
    const { patch, files, commits, commitFiles } = repo.read();
    const check = checkGovernedRecords(patch, { declaredFiles: files, declaredCommits: commits, commitFiles });
    expect(check.problems).toEqual([]);
    // Was [true, false], which pinned the defect round 3 found: the first copy's comparison says nothing about the head's.
    expect(check.archives.map((fact) => fact.verified)).toEqual([false, false]);
  });

  it("states a retirement's From: header as text a Session can set, not as who wrote it", () => {
    const repo = repository();
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    repo.commit({ [DRAFT]: null }, "chore(arcadia): retire the failed candidate's completion draft\n\nArcadia-Retired-Completion-Draft: complete-a\n");
    const section = repo.section();
    expect(section).not.toContain("by the Arcadia Controller");
    expect(section).toContain("- Not verified (Draft retirement):");
    expect(section).toContain("by its From: header, trailers and content");
  });
});

/** The last commit's id, as the section must name it. */
const headOf = (repo: ReturnType<typeof repository>) => {
  const { commits } = repo.read();
  return commits[commits.length - 1];
};

describe("a Verified fact holds at the head: any later commit touching its record voids it, by name", () => {
  const editedCopy = ask({ candidate_revision: "1234567", notes: "edited after review" });
  const laterCommits: Array<[string, (repo: ReturnType<typeof repository>, message: string) => void]> = [
    ["edit", (repo, message) => repo.commit({ [ARCHIVE]: editedCopy }, message)],
    ["delete", (repo, message) => repo.commit({ [ARCHIVE]: null }, message)],
    ["re-add", (repo, message) => {
      repo.commit({ [ARCHIVE]: null }, message);
      repo.commit({ [ARCHIVE]: editedCopy }, message);
    }],
    ["rename", (repo, message) => repo.commit({ [ARCHIVE]: null, [".arcadia/asks/archive/agent-ask-moved.yaml"]: ARCHIVE_CONTENT }, message)]
  ];
  const messages: Array<[string, string]> = [["plain", "chore: later\n"], ["attested", `chore(arcadia): later\n\n${SETTLED}\n`]];

  for (const [change, later] of laterCommits) {
    for (const [kind, message] of messages) {
      it(`a later ${change} of the archive, ${kind}, voids the archive, its citation and its shape`, () => {
        const repo = repository();
        settle(repo);
        const before = repo.section();
        expect(before).toContain(`- Verified (Archived Ask): ${JSON.stringify(ARCHIVE)}`);
        expect(before).toContain(`- Verified (Agent Ask citation): "complete-a"`);
        const settled = headOf(repo);
        later(repo, message);
        const section = repo.section();
        expect(section).not.toContain("Nothing below is verified");
        expect(section).not.toContain(`- Verified (Archived Ask): ${JSON.stringify(ARCHIVE)}`);
        expect(section).not.toContain(`- Verified (Agent Ask citation): "complete-a"`);
        expect(section).not.toContain(`- Verified (Record shape): ${JSON.stringify(ARCHIVE)}`);
        const firstLater = repo.read().commits[repo.read().commits.indexOf(settled) + 1];
        expect(section).toContain(`- Not verified (Archived Ask): ${JSON.stringify(ARCHIVE)} differs from the draft this patch deletes only in candidate_revision, but commit ${firstLater} touches this record afterwards`);
        expect(section).toMatch(new RegExp(`- Not verified \\(Agent Ask citation\\): "complete-a" .*but commit ${firstLater} touches this record afterwards`));
        expect(section).toMatch(new RegExp(`- Not verified \\(Record shape\\): ${JSON.stringify(ARCHIVE).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} .*commit ${firstLater} touches`));
      });
    }
  }

  it("a later touch of the record the citation sits in voids the citation and that shape, not the archive", () => {
    for (const [file, content] of [[PLAN_PATH, `${completed("complete-a")}Trailing note.\n`], ["MISSION_LOG.md", "# Mission Log\n\n## 2026-10-04 — Completed it\n\nAnother line.\n"]] as const) {
      for (const [kind, message] of messages) {
        const repo = repository();
        settle(repo);
        repo.commit({ [file]: content }, message);
        const toucher = headOf(repo);
        const section = repo.section();
        expect(section, `${file} ${kind}`).toMatch(new RegExp(`- Not verified \\(Record shape\\): "${file.replace(".", "\\.")}" .*commit ${toucher} touches`));
        if (file === PLAN_PATH) expect(section, kind).toMatch(new RegExp(`- Not verified \\(Agent Ask citation\\): "complete-a" .*but commit ${toucher} touches this record afterwards`));
        expect(section, `${file} ${kind}`).toContain(`- Verified (Archived Ask): ${JSON.stringify(ARCHIVE)}`);
      }
    }
  });

  it("a citation found only in the Mission Log reads Verified until a later commit touches the Mission Log", () => {
    const id = autoSettleRequestId("p", ACTION, DRAFT_CONTENT);
    const log = `# Mission Log\n\n## 2026-10-04 — Completed it\n\nSettled by ${id}.\n`;
    const repo = repository();
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    repo.commit({ [DRAFT]: null, [ARCHIVE]: ARCHIVE_CONTENT, [PLAN_PATH]: completed("complete-a"), "PROJECT.md": project("next-one"), "MISSION_LOG.md": log }, `chore(arcadia): settle\n\n${SETTLED}\n`);
    expect(repo.section()).toContain(`- Verified (Agent Ask citation): ${JSON.stringify(id)}`);
    repo.commit({ "MISSION_LOG.md": `${log}\nAnother line.\n` }, `chore(arcadia): log\n\n${SETTLED}\n`);
    const section = repo.section();
    expect(section).not.toContain(`- Verified (Agent Ask citation): ${JSON.stringify(id)}`);
    expect(section).toMatch(new RegExp(`- Not verified \\(Agent Ask citation\\): ${JSON.stringify(id)} .*but commit ${headOf(repo)} touches this record afterwards`));
  });

  it("a draft edited between preservation and settlement voids the citation that names it", () => {
    const repo = repository();
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    repo.commit({ [DRAFT]: `${DRAFT_CONTENT}\n` }, `chore(candidate): edit\n\n${PRESERVED}\n`);
    const edited = headOf(repo);
    repo.commit({ [DRAFT]: null, [ARCHIVE]: ARCHIVE_CONTENT, [PLAN_PATH]: completed("complete-a"), "PROJECT.md": project("next-one") }, `chore(arcadia): settle\n\n${SETTLED}\n`);
    const section = repo.section();
    expect(section).toMatch(new RegExp(`- Not verified \\(Agent Ask citation\\): "complete-a" .*but commit ${edited} touches this record afterwards`));
  });

  it("a draft re-created after its settlement voids the archive, the citation and the draft's shape", () => {
    const repo = repository();
    settle(repo);
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
    const again = headOf(repo);
    const section = repo.section();
    expect(section).toContain(`but commit ${again} touches this record afterwards`);
    expect(section).not.toContain("- Verified (Archived Ask):");
    expect(section).not.toContain("- Verified (Agent Ask citation):");
    expect(section).not.toContain(`- Verified (Record shape): ${JSON.stringify(DRAFT)}`);
  });

  it("a retired draft brought back voids the retirement, which otherwise reads Verified", () => {
    const CONTROLLER = { name: "Arcadia Controller", email: "controller@arcadia.local" };
    const repo = repository();
    settleWithRetirement(repo, CONTROLLER);
    const honest = repo.section();
    expect(honest).toContain("- Verified (Draft retirement):");
    const { commits } = repo.read();
    repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve again\n\n${PRESERVED}\n`);
    const again = repo.read().commits[commits.length];
    const section = repo.section();
    expect(section).not.toContain("- Verified (Draft retirement):");
    expect(section).toMatch(new RegExp(`- Not verified \\(Draft retirement\\): .*but commit ${again} touches this record afterwards`));
  });

  it("names nothing and voids nothing on an honest settlement, where a draft's archive is its expected second touch", () => {
    const repo = repository();
    settle(repo);
    const section = repo.section();
    expect(section).not.toContain("touches this record afterwards");
    expect(section).not.toContain("touches it after");
    expect(section).toContain("A Verified entry holds at the head");
  });
});

/** A failed candidate's draft, its host retirement under the Controller's identity, then a second draft settled. */
function settleWithRetirement(repo: ReturnType<typeof repository>, controller: { name: string; email: string }) {
  repo.commit({ [DRAFT]: DRAFT_CONTENT }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
  repo.commitAs(controller, { [DRAFT]: null }, "chore(arcadia): retire the failed candidate's completion draft\n\nArcadia-Retired-Completion-Draft: complete-a\n");
  const second = ".arcadia/asks/agent-ask-complete-b.yaml";
  const secondArchive = ".arcadia/asks/archive/agent-ask-complete-b.yaml";
  repo.commit({ [second]: ask({ request_id: "complete-b", candidate_revision: "abcdef1" }, 2) }, `chore(candidate): preserve\n\n${PRESERVED}\n`);
  repo.commit({
    [second]: null, [secondArchive]: ask({ request_id: "complete-b", candidate_revision: "1234567" }), [PLAN_PATH]: completed("complete-b"), "PROJECT.md": project("next-one"),
    "MISSION_LOG.md": "# Mission Log\n\n## 2026-10-04 — Completed it\n"
  }, `chore(arcadia): settle\n\n${SETTLED}\n`);
}
