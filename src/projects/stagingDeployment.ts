import { spawnSync } from "node:child_process";
import type Database from "better-sqlite3";
import { validationError } from "../cli/errors.js";
import {
  createArtifactRecord,
  getProject,
  getProjectMetadata,
  updateProject,
  upsertProjectMetadata
} from "../db/repositories.js";
import type { Artifact } from "../domain/types.js";
import { decodeStringArray } from "./setup.js";

export interface StagingDeploymentResult {
  url: string;
  projectName: string;
  artifact: Artifact;
  output: string;
}

export interface StagingCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export type StagingCommandRunner = (command: string, args: string[], cwd: string) => StagingCommandResult;

/** Deploy the already-built static output. The coding agent never receives Cloudflare credentials. */
export function deployApprovedProjectProposal(
  db: Database.Database,
  input: { projectId: string; workItemId: string | null; repoPath: string; run?: StagingCommandRunner }
): StagingDeploymentResult {
  const project = getProject(db, input.projectId);
  const metadata = getProjectMetadata(db, input.projectId);
  if (!project || !metadata) {
    throw validationError("Approved staging deployment is missing its Project metadata.", { projectId: input.projectId });
  }
  if (metadata.project_template !== "astro_field_notes_cloudflare") {
    throw validationError("Automatic staging currently supports only the Astro Field Notes template.", {
      projectTemplate: metadata.project_template
    });
  }
  const projectName = cloudflareProjectName(project.slug);
  const run = input.run ?? runStagingCommand;
  const listed = run("pnpm", ["exec", "wrangler", "pages", "project", "list", "--json"], input.repoPath);
  assertCommandSucceeded(listed, "Cloudflare Pages project lookup failed. Confirm Wrangler is installed and authenticated.");
  const existingNames = parsePagesProjectNames(listed.stdout);
  if (!existingNames.has(projectName)) {
    const created = run(
      "pnpm",
      ["exec", "wrangler", "pages", "project", "create", projectName, "--production-branch", "main"],
      input.repoPath
    );
    assertCommandSucceeded(created, "Cloudflare Pages project creation failed.");
  }
  const deployed = run(
    "pnpm",
    [
      "exec", "wrangler", "pages", "deploy", "dist",
      "--project-name", projectName,
      "--branch", "staging",
      "--commit-dirty=true"
    ],
    input.repoPath
  );
  assertCommandSucceeded(deployed, "Cloudflare Pages staging deployment failed.");
  const output = [deployed.stdout, deployed.stderr].filter(Boolean).join("\n").trim();
  const url = parsePagesDeploymentUrl(output, projectName);
  if (!url) {
    throw validationError("Cloudflare reported success without an HTTPS pages.dev URL.", { output: output.slice(-2000) });
  }

  upsertProjectMetadata(db, {
    projectId: project.id,
    aliases: decodeStringArray(metadata.aliases),
    repoPath: metadata.repo_path,
    repositoryUrl: metadata.repository_url,
    projectTemplate: metadata.project_template,
    generatorSkill: metadata.generator_skill,
    deploymentTarget: metadata.deployment_target,
    buildAgent: metadata.build_agent,
    stagingUrl: url,
    statusSummary: `Staging is live at ${url}`,
    validationCommands: decodeStringArray(metadata.validation_commands)
  });
  updateProject(db, project.id, { status: "active" });
  const artifact = createArtifactRecord(db, {
    projectId: project.id,
    workItemId: input.workItemId,
    title: `Live staging URL: ${url}`,
    artifactType: "staging_deployment",
    status: "ready",
    path: null
  });
  return { url, projectName, artifact, output };
}

export function parsePagesDeploymentUrl(output: string, projectName: string): string | null {
  const urls = output.match(/https:\/\/[a-z0-9][a-z0-9.-]*\.pages\.dev\/?/gi) ?? [];
  const clean = Array.from(new Set(urls.map((url) => url.replace(/\/$/, ""))));
  return clean.find((url) => url.toLowerCase().includes(`staging.${projectName.toLowerCase()}.pages.dev`))
    ?? clean[0]
    ?? null;
}

function parsePagesProjectNames(output: string): Set<string> {
  try {
    const parsed = JSON.parse(output) as unknown;
    const candidates = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { result?: unknown }).result)
        ? (parsed as { result: unknown[] }).result
        : [];
    return new Set(candidates.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const name = (entry as { name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }));
  } catch {
    throw validationError("Cloudflare Pages project lookup returned invalid JSON.", { output: output.slice(-2000) });
  }
}

function cloudflareProjectName(slug: string): string {
  const value = slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 58);
  if (!value) throw validationError("Project name cannot be converted to a Cloudflare Pages name.", { slug });
  return value;
}

function assertCommandSucceeded(result: StagingCommandResult, message: string): void {
  if (result.status === 0) return;
  throw validationError(message, {
    exitStatus: result.status,
    error: result.error,
    output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim().slice(-4000)
  });
}

function runStagingCommand(command: string, args: string[], cwd: string): StagingCommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error?.message ?? null
  };
}
