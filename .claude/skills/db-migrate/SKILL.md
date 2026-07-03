---
name: db-migrate
description: Generate a named Prisma migration, regenerate the client, and show the SQL diff for review
disable-model-invocation: true
---

Ask the user for a migration name if not provided (use snake_case, e.g. add_submission_status).

Then run these steps in order from the repo root (`guest-registration-platform/`):

1. Check DATABASE_URL is pointing to a local/dev host. If it contains a non-localhost hostname, warn the user before proceeding.
2. Run: `pnpm --filter @gr/db migrate:dev --name <migration-name>`
3. Run: `pnpm --filter @gr/db generate`
4. Find the newest directory under `packages/db/prisma/migrations/` and print its `.sql` file contents so the user can review the SQL before committing.

If any step fails, show the full error output and stop.
