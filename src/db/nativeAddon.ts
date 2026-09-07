const MISE_REMEDIATION = "mise install && mise exec -- pnpm rebuild better-sqlite3";

/**
 * Raised before a SQLite operation when the better-sqlite3 native addon was
 * compiled for a different Node ABI than the process currently running it.
 */
export class SqliteNativeAddonAbiError extends Error {
  readonly runtimeAbi: string;
  readonly addonAbi: string;
  readonly remediation: string;
  readonly runtimeExecutable: string;

  constructor(runtimeAbi: string, addonAbi: string, runtimeExecutable = process.execPath) {
    const remediation = MISE_REMEDIATION;
    super(
      `SQLite native addon ABI mismatch: ${runtimeExecutable} is running Node ABI ${runtimeAbi}, but better-sqlite3 was built for ABI ${addonAbi}. Run \`${remediation}\` from the Arcadia repository, then relaunch Arcadia through mise.`
    );
    this.name = "SqliteNativeAddonAbiError";
    this.runtimeAbi = runtimeAbi;
    this.addonAbi = addonAbi;
    this.remediation = remediation;
    this.runtimeExecutable = runtimeExecutable;
  }
}

/**
 * better-sqlite3 exposes its compiled ABI only when Node loads its native
 * addon. Intercept that specific loader error at the two construction
 * boundaries so callers get a deterministic repair instead of Node's raw
 * NODE_MODULE_VERSION exception.
 */
export function withSqliteNativeAddonPreflight<T>(open: () => T): T {
  try {
    return open();
  } catch (error) {
    const addonAbi = addonAbiFromLoadError(error);
    const runtimeAbi = process.versions.modules;

    if (addonAbi && runtimeAbi && addonAbi !== runtimeAbi) {
      throw new SqliteNativeAddonAbiError(runtimeAbi, addonAbi);
    }

    throw error;
  }
}

export function isSqliteNativeAddonAbiError(error: unknown): error is SqliteNativeAddonAbiError {
  return error instanceof SqliteNativeAddonAbiError;
}

/**
 * Raised when the OS denies a write the workspace database needs (WAL/SHM
 * creation, journal writes, or the file itself) — the shape a sandboxed coding
 * agent hits when its filesystem write allowlist does not cover the resolved
 * Arcadia workspace directory. better-sqlite3 reports this as
 * `SQLITE_READONLY`/`SQLITE_CANTOPEN` with no path in the message, which reads
 * identically to a corrupt or missing database; naming the exact blocked path
 * here is what turns that into an actionable remedy instead of a guess.
 */
export class SqliteWorkspaceWriteDeniedError extends Error {
  readonly databaseFile: string;

  constructor(databaseFile: string, cause: string) {
    super(
      `SQLite could not write to the workspace database: ${databaseFile} (${cause}). ` +
        "This is almost always a sandbox or filesystem permission gap, not a corrupt database. Fix it with one of:\n" +
        `  - grant your coding agent's sandbox write access to the containing directory (e.g. add it to Claude Code's permissions.additionalDirectories)\n` +
        `  - run the command outside the sandbox\n` +
        `  - check the file and directory are writable by the current user (\`ls -la ${databaseFile}\`)`
    );
    this.name = "SqliteWorkspaceWriteDeniedError";
    this.databaseFile = databaseFile;
  }
}

export function isSqliteWorkspaceWriteDeniedError(error: unknown): error is SqliteWorkspaceWriteDeniedError {
  return error instanceof SqliteWorkspaceWriteDeniedError;
}

const WRITE_DENIED_SQLITE_CODES = new Set(["SQLITE_READONLY", "SQLITE_CANTOPEN", "SQLITE_IOERR"]);

/**
 * Intercept a write-path SQLite open/operation that failed because the OS
 * denied the write, and rethrow with the exact database file path named. Only
 * write paths should use this: a genuinely read-only connection has nothing
 * to diagnose here, and wrapping it would misreport an unrelated read failure
 * as a write-permission gap.
 */
export function withSqliteWorkspaceWriteDiagnostics<T>(databaseFile: string, open: () => T): T {
  try {
    return open();
  } catch (error) {
    if (error instanceof Error && isWriteDeniedSqliteError(error)) {
      throw new SqliteWorkspaceWriteDeniedError(databaseFile, error.message);
    }
    throw error;
  }
}

function isWriteDeniedSqliteError(error: Error): boolean {
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return WRITE_DENIED_SQLITE_CODES.has(code) || /attempt to write a readonly database/i.test(error.message);
}

function addonAbiFromLoadError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return error.message.match(/compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1] ?? null;
}
