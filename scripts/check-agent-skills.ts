import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

/** Validate shared skill entrypoints and the Claude alias to that exact source. */
export function inspectAgentSkills(root: string): string[] {
  const problems: string[] = [];
  const shared = path.join(root, ".agents/skills");
  if (!existsSync(shared)) return ["Missing .agents/skills directory"];
  for (const name of readdirSync(shared).sort()) {
    const source = path.join(shared, name);
    if (!lstatSync(source).isDirectory()) {
      problems.push(`${name}: shared source must be a maintained directory`);
      continue;
    }
    const entrypoint = path.join(source, "SKILL.md");
    try {
      const content = readFileSync(entrypoint, "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      if (!frontmatter) throw new Error("missing YAML frontmatter");
      const metadata = parse(frontmatter[1]);
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64 || metadata?.name !== name) {
        problems.push(`${name}: frontmatter name must match a portable directory name`);
      }
      if (typeof metadata?.description !== "string" || !metadata.description.trim() || metadata.description.length > 1024) {
        problems.push(`${name}: description must contain 1–1024 characters`);
      }
      const alias = path.join(root, ".claude/skills", name);
      if (!lstatSync(alias).isSymbolicLink() || path.isAbsolute(readlinkSync(alias)) || realpathSync(alias) !== realpathSync(source)) {
        problems.push(`${name}: Claude discovery must link to the shared source`);
      }
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = inspectAgentSkills(process.cwd());
  process.stdout.write(`${JSON.stringify({ schema: "arcadia-skill-discovery-v1", agents: ["codex", "claude", "opencode"], problems }, null, 2)}\n`);
  if (problems.length) process.exitCode = 1;
}
