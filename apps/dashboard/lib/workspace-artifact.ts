import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { runAskTrailCommand } from "../../../src/commands/askTrail";
import { withReadOnlyDatabase } from "../../../src/db/connection";
import { getArtifact, getProjectMetadata } from "../../../src/db/repositories";
import { resolveReadyWorkspace } from "../../../src/cli/workspace";
import { getWorkspacePaths } from "../../../src/workspace/paths";

export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export class ArtifactOpenError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const fail = (message: string, status = 422): never => { throw new ArtifactOpenError(message, status); };
const inside = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

// Darwin's public sys/fcntl.h defines this flag; Node does not expose it.
// Unlike O_NOFOLLOW, the kernel rejects symlinks in every path component.
// https://github.com/apple/darwin-xnu/blob/main/bsd/sys/fcntl.h
// The two flags are mutually exclusive (EINVAL); use ANY alone on Darwin.
const DARWIN_O_NOFOLLOW_ANY = 0x20000000;

async function openContainedFile(canonical: string) {
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  try {
    if (process.platform === "darwin") return await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK | DARWIN_O_NOFOLLOW_ANY);
    if (process.platform !== "linux") return fail("Safe Artifact opening is unavailable on this platform.", 503);
    // Node has no openat API. On Linux, procfs exposes the pinned directory
    // descriptor. Walk from / so even ancestors of the configured root cannot
    // be substituted with symlinks. Each next open is relative to a held inode.
    const components = canonical.split(path.sep).filter(Boolean);
    let directory = await open("/", constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      for (const component of components.slice(0, -1)) {
        const next = await open(`/proc/self/fd/${directory.fd}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const previous = directory;
        directory = next;
        await previous.close();
      }
      return await open(`/proc/self/fd/${directory.fd}/${components.at(-1)!}`, flags);
    } finally { await directory.close(); }
  } catch (error) {
    if (["ELOOP", "ENOTDIR", "ESTALE"].includes((error as NodeJS.ErrnoException).code ?? "")) return fail("The Artifact path changed while opening it.", 409);
    throw error;
  }
}

/** Domain Artifacts only. The receipt relation and configured roots are guardrails,
 * not authenticated access control: this dashboard is local and single-operator. */
export async function readWorkspaceArtifact(id: string, receipt: string) {
  const { workspacePath } = resolveReadyWorkspace();
  let trail;
  try { trail = runAskTrailCommand({ workspace: workspacePath, id: receipt }).data; }
  catch { return fail("The Ask receipt could not be read.", 404); }
  const runs = trail.asks.flatMap(ask => ask.runs).filter(run => run.artifacts.some(artifact => artifact.id === id));
  if (!runs.length) return fail("This Artifact is not linked to a Run from this Ask.", 404);
  const { artifact, repo } = withReadOnlyDatabase(workspacePath, db => {
    const artifact = getArtifact(db, id);
    if (!artifact?.project_id || !runs.some(run => run.projectId === artifact.project_id)) return fail("The Artifact and Run must belong to the same Project.", 404);
    return { artifact, repo: getProjectMetadata(db, artifact.project_id)?.repo_path };
  });
  if (!artifact.path) return fail("This Artifact has no file path.");
  // Matches the Artifact CLI: relative persisted paths resolve under the workspace.
  const candidate = path.resolve(workspacePath, artifact.path);
  const configured = [getWorkspacePaths(workspacePath).artifacts, ...(repo ? [repo] : [])];
  const roots: string[] = [];
  for (const root of configured) {
    if (!path.isAbsolute(root) || path.parse(root).root === path.resolve(root)) continue;
    try { const canonical = await realpath(root); if (canonical !== path.parse(canonical).root) roots.push(canonical); } catch { /* Missing configured roots grant no fallback. */ }
  }
  let canonical: string;
  try { canonical = await realpath(candidate); } catch { return fail("The Artifact file is missing or unavailable.", 404); }
  if (!roots.some(root => inside(root, canonical))) return fail("The Artifact file is outside its configured output roots.", 403);
  const ext = path.extname(candidate).toLowerCase();
  const types: Record<string, string> = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".md": "text/plain", ".json": "text/plain", ".csv": "text/plain", ".tsv": "text/plain", ".log": "text/plain", ".yaml": "text/plain", ".yml": "text/plain" };
  const contentType = types[ext];
  if (!contentType) return fail("This file type cannot be opened here. Supported: SVG, PNG, JPEG, WebP and plain text.", 415);
  // Kernel all-component rejection (Darwin) or pinned traversal (Linux)
  // binds the open to the checked tree. NONBLOCK keeps FIFO swaps from hanging.
  const handle = await openContainedFile(canonical);
  let bytes: Buffer;
  try {
    const info = await handle.stat();
    if (!info.isFile()) return fail("The Artifact path is not a regular file.");
    if (info.size > MAX_ARTIFACT_BYTES) return fail("The Artifact exceeds the 4 MiB viewer limit.", 413);
    // A fixed limit plus one byte bounds even a file that grows after stat.
    const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) { const read = await handle.read(buffer, size, buffer.length - size, size); if (!read.bytesRead) break; size += read.bytesRead; }
    if (size > MAX_ARTIFACT_BYTES || (await handle.stat()).size > MAX_ARTIFACT_BYTES) return fail("The Artifact exceeds the 4 MiB viewer limit.", 413);
    bytes = buffer.subarray(0, size);
  } finally { await handle.close(); }
  if (contentType === "text/plain" || ext === ".svg") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("The Artifact is not readable UTF-8 text.", 415); }
    if (text.includes("\0")) return fail("The Artifact contains binary data.", 415);
    if (ext === ".svg" && (!/^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/i.test(text) || /<!DOCTYPE|<!ENTITY/i.test(text))) return fail("The Artifact is not a supported SVG image.", 415);
  } else if ((ext === ".png" && !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    || ([".jpg", ".jpeg"].includes(ext) && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))
    || (ext === ".webp" && !(bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP"))) return fail("The Artifact bytes do not match its image type.", 415);
  return { bytes, contentType };
}
