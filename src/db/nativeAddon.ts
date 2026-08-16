const PINNED_NODE_VERSION = "22.23.1";
const PNPM_VERSION = "11.7.0";

/**
 * Raised before a SQLite operation when the better-sqlite3 native addon was
 * compiled for a different Node ABI than the process currently running it.
 */
export class SqliteNativeAddonAbiError extends Error {
  readonly runtimeAbi: string;
  readonly addonAbi: string;
  readonly remediation: string;

  constructor(runtimeAbi: string, addonAbi: string) {
    const remediation = `volta run --node ${PINNED_NODE_VERSION} --pnpm ${PNPM_VERSION} pnpm rebuild better-sqlite3`;
    super(
      `SQLite native addon ABI mismatch: Node ABI ${runtimeAbi} is running a better-sqlite3 binary built for ABI ${addonAbi}. Run \`${remediation}\` from the Arcadia repository, then relaunch Arcadia through Volta.`
    );
    this.name = "SqliteNativeAddonAbiError";
    this.runtimeAbi = runtimeAbi;
    this.addonAbi = addonAbi;
    this.remediation = remediation;
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
