import { resolveReadyWorkspace } from "../cli/workspace.js";
import { openDatabase } from "../db/connection.js";
import { createIntelligenceServer } from "../intelligence/api/server.js";
import { createSqliteIntelligenceArtifactStore } from "../intelligence/artifacts/store.js";
import { createCodexCliImageExecutor } from "../intelligence/codex/imageExecutor.js";
import { loadIntelligenceConfig } from "../intelligence/config/defaults.js";
import { createSqliteIntelligenceJobRepository } from "../intelligence/db/sqliteRepository.js";
import { IntelligenceWorker } from "../intelligence/jobs/worker.js";
import { createLiteLlmHttpClient } from "../intelligence/litellm/httpClient.js";

const DEFAULT_PORT = 4710;
export interface IntelligenceServeOptions {
  workspace: string;
  port?: number;
}


/**
 * Starts the Arcadia Intelligence v0.1 HTTP API together with its in-process
 * worker in a single foreground process. Stop with Ctrl+C / SIGTERM.
 */
export function runIntelligenceServeCommand(options: IntelligenceServeOptions): void {
  const { workspacePath } = resolveReadyWorkspace(options.workspace);
  const db = openDatabase(workspacePath);
  const repository = createSqliteIntelligenceJobRepository(db);
  const artifactStore = createSqliteIntelligenceArtifactStore(db, workspacePath);
  const config = loadIntelligenceConfig(process.env);
  const liteLlmClient = createLiteLlmHttpClient({
    baseUrl: config.liteLlmBaseUrl,
    apiKey: config.liteLlmApiKey,
  });

  const codexImageExecutor = createCodexCliImageExecutor({
    workspaceRoot: workspacePath,
    artifactStore,
    config,
  });
  const worker = new IntelligenceWorker(
    repository,
    liteLlmClient,
    config,
    artifactStore,
    codexImageExecutor,
  );
  const stopWorker = worker.start();

  const server = createIntelligenceServer({ repository, config, artifactStore });
  const port = options.port ?? DEFAULT_PORT;

  const shutdown = (): void => {
    stopWorker();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.listen(port, () => {
    const enabledRouteCount = config.routes.filter((route) => route.enabled).length;
    process.stdout.write(
      `Arcadia Intelligence listening on http://127.0.0.1:${port} ` +
        `(workspace: ${workspacePath}, LiteLLM: ${config.liteLlmBaseUrl}, ${enabledRouteCount} route(s) configured)\n`,
    );
  });
}
