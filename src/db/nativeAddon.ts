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

function addonAbiFromLoadError(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  return error.message.match(/compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1] ?? null;
}
