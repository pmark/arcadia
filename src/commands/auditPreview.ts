import { createReadStream, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { createSuccess, type CommandSuccess } from "../cli/response.js";
import { validationError } from "../cli/errors.js";

export const HOST_AUDIT_PREVIEW_MAX_SECONDS = 30 * 60;
const HOST = "127.0.0.1";

export interface HostAuditPreview {
  url: string;
  root: string;
  expiresAt: string;
  close(): Promise<void>;
}

/** Start a read-only static preview on loopback from a host terminal. The
 * unattended agent profile remains network-disabled; this route is explicitly
 * host-owned and refuses to run from a sandboxed coding-agent process. */
export async function startHostAuditPreview(rootInput: string, seconds: number): Promise<HostAuditPreview> {
  if (process.env.CODEX_SANDBOX) {
    throw validationError("Host audit preview must be started from a plain host terminal; the agent sandbox stays network-disabled.", {
      remedy: "Run `arcadia audit host-preview --root <built-site-directory> --seconds 900` in a host terminal."
    });
  }
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > HOST_AUDIT_PREVIEW_MAX_SECONDS) {
    throw validationError(`Audit preview duration must be an integer from 60 to ${HOST_AUDIT_PREVIEW_MAX_SECONDS} seconds.`, { seconds });
  }
  let root: string;
  try { root = realpathSync(rootInput); }
  catch { throw validationError("Audit preview root must be an existing directory.", { root: rootInput }); }
  if (!statSync(root).isDirectory()) throw validationError("Audit preview root must be an existing directory.", { root });

  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": "no-store" }).end();
      return;
    }
    let requestUrl: URL;
    let pathname: string;
    try {
      requestUrl = new URL(request.url ?? "/", `http://${HOST}`);
      pathname = decodeURIComponent(requestUrl.pathname);
    }
    catch { response.writeHead(400, { "Cache-Control": "no-store" }).end(); return; }
    if (pathname.includes("\\") || pathname.includes("\0")) {
      response.writeHead(400, { "Cache-Control": "no-store" }).end();
      return;
    }
    const relative = pathname.replace(/^\/+/, "") || "index.html";
    let target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403, { "Cache-Control": "no-store" }).end();
      return;
    }
    try {
      if (!existsSync(target)) throw new Error("missing");
      if (lstatSync(target).isSymbolicLink()) {
        const real = realpathSync(target);
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error("outside root");
        target = real;
      }
      if (statSync(target).isDirectory()) {
        if (!pathname.endsWith("/")) {
          response.writeHead(308, {
            Location: `${requestUrl.pathname}/${requestUrl.search}`,
            "Cache-Control": "no-store"
          }).end();
          return;
        }
        target = path.join(target, "index.html");
      }
      if (!existsSync(target)) throw new Error("missing index");
      const realTarget = realpathSync(target);
      if (!realTarget.startsWith(`${root}${path.sep}`) || !statSync(realTarget).isFile()) throw new Error("not a regular file");
      const extension = path.extname(realTarget).toLowerCase();
      const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": String(statSync(realTarget).size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      if (request.method === "HEAD") response.end();
      else {
        const stream = createReadStream(realTarget);
        stream.once("error", () => response.destroy());
        response.once("close", () => stream.destroy());
        stream.pipe(response);
      }
    } catch {
      response.writeHead(404, { "Cache-Control": "no-store" }).end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw validationError("The loopback audit preview did not receive a TCP address.");
  }
  const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
  const expiry = setTimeout(() => {
    server.close();
    server.closeAllConnections();
  }, seconds * 1000);
  expiry.unref();
  return {
    url: `http://${HOST}:${address.port}/`,
    root,
    expiresAt,
    close: () => {
      clearTimeout(expiry);
      return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

export async function runHostAuditPreviewCommand(options: { root: string; seconds: number }): Promise<CommandSuccess<Omit<HostAuditPreview, "close">>> {
  const preview = await startHostAuditPreview(options.root, options.seconds);
  return createSuccess({
    command: "audit.host-preview",
    data: { url: preview.url, root: preview.root, expiresAt: preview.expiresAt }
  });
}

export function renderHostAuditPreviewSuccess(response: CommandSuccess<Omit<HostAuditPreview, "close">>): string[] {
  return [
    `Host-owned static preview: ${response.data.url}`,
    `Read-only root: ${response.data.root}`,
    `Expires: ${response.data.expiresAt}`,
    "Loopback only; GET and HEAD only; no network permission or credentials are granted to the agent sandbox."
  ];
}

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2"
};
