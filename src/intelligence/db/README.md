# Database Notes

v0.1 needs one durable job table.

Keep all request payloads and results as JSON columns until real usage demonstrates
a need for separate request, artifact, policy, quota, or usage-ledger tables.

The worker must use a lease or equivalent claim mechanism so that process restarts
do not leave jobs permanently running.
