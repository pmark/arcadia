import { createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

export interface TrackedProcess {
  child: ChildProcess;
  stop(): Promise<void>;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

export function startProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; logPath: string }
): TrackedProcess {
  const output = createWriteStream(options.logPath, { flags: "a" });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);
  return {
    child,
    async stop() {
      if (child.exitCode !== null || !child.pid) {
        output.end();
        return;
      }
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
      await Promise.race([
        new Promise<void>((resolve) => child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000))
      ]);
      if (child.exitCode === null) {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }
      output.end();
    }
  };
}

export async function waitForHttp(url: string, process: TrackedProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.child.exitCode !== null) {
      throw new Error(`Process exited before serving ${url}: ${process.child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
