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
