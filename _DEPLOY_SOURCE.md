# Builderz Mission Control Railway hosting

Issue: A360D-135. Source: existing A360D-307 reliability head
`dadb341a862c3c37731ee0399e5a65583fb01a47`.
Worktree: `C:/Projects2/builderz-a360d-135-railway`.
Branch: `codex/a360d-135-builderz-railway`.

Railway project: `6cc9dd1d-8e14-4692-b2bb-7626a4b3aa77`.
Service: `eefbfd6a-f9ac-496c-b30e-283d7ab602a8` (builderz).
Environment: `ca04eab0-7e4c-4ea4-947b-3d6c839e2046` (tool environment).
Persistent volume: `251e423d-d2e2-4c00-aa58-108c2b090a54`, mounted `/app/.data`.

Deploy with the existing Dockerfile. Gateway is optional; hosting alone does not
connect Windows agents. No inference calls are required for hosting checks.
Database backup uses SQLite online backup, not copying a running WAL database.
Backup integrity checked; one existing user preserved. Backup is outside git in
`C:/Projects2/.secrets/builderz-a360d-135-20261127/mission-control.db`.
Restore the backup before publishing the domain; never expose an unseeded setup.
Do not copy local log files, environment files or session values into source.

The local service at `http://100.79.143.126:3100/` remains running. Do not retire it
until the hosted replacement, login and persistent data are verified. Rollback:
use the previous Railway release, or use the unchanged local service. Hosted
activity after the initial snapshot is separate from local database activity.

Verified public URL: https://builderz-production.up.railway.app/ . Existing login and authenticated agents/tasks returned 200; unauthenticated agents returned 401. All 19 referenced JS/CSS assets returned 200. Domain targets runtime port 8080; host allowlist is comma-delimited. Local service retained. Agent integrations remain unverified.

## A360 relay observations

The existing Activity screen receives metadata through authenticated
`/api/a360/observations`. Source: the existing Windows relay `REGISTRY.json`
and queue records, read only. The publisher selects names, client, original
session ID, message ID, status and original event time. It excludes bodies,
subjects, results, event notes, roles and configuration. Events are deduplicated
per workspace, including across cloud restarts, and retain their actual dates.
The page shows source age and reports Stale after five minutes.

This is observation, not chat control, a proof runner or a task database. Relay
Done does not mean a feature shipped. Jira remains the source for project work.
Existing sample/older Builderz agents are preserved, not relabelled as A360 lanes.

Publisher: `scripts/publish-a360-observations.mjs`, using Node's `--env-file`
with the existing central environment file. The separate Windows task
`A360-Builderz-Observations` publishes every minute while Chris is signed in.
It does not replace the local Builderz service task. PC-off data is Stale;
the existing Railway dashboard watchdog owns alerts. No inference is called.
