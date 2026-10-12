/** Git queries used for Ask isolation/checkout ownership must have no inherited output side effects. */
export function isolatedGitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    // Keep only resolved commit identity; discard relocation, config injection, and every trace family.
    if (key.startsWith("GIT_") && !/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)$/.test(key)) delete env[key];
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  // Trace2 reads global/system configuration before ordinary -c/local overrides.
  // Explicit environment targets override those global targets without opening files.
  env.GIT_TRACE2 = "0";
  env.GIT_TRACE2_EVENT = "0";
  env.GIT_TRACE2_PERF = "0";
  return env;
}

