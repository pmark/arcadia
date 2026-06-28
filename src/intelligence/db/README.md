# Database Notes

The `intelligence_jobs` table lives in the shared Arcadia workspace database. Its
migration is `ensureIntelligenceJobsTable` in [`../../db/schema.ts`](../../db/schema.ts),
applied the same way as every other table in `applyMigrations`. There is no
separate Intelligence database or migration runner.

All request payloads and results are kept as JSON columns (`request_json`,
`result_json`, `validation_json`, `usage_json`) rather than separate tables, per
v0.1 scope.

The worker claims jobs with a lease (`lease_owner`, `lease_expires_at` columns)
so that a crashed or restarted worker process does not leave jobs stuck in
`running` forever — see `claimNextQueuedJob` in
[`sqliteRepository.ts`](./sqliteRepository.ts).
