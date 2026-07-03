# Retention Policy

## Design

Every `GuestSubmission` stores at creation time:

- `legalBasis` — MVP default `LEGAL_OBLIGATION` (accommodation registration duty).
- `retainUntil` — `submittedAt + RETENTION_DEFAULT_DAYS` (default 365).
- `deleteAfter` — `retainUntil + 30 days` grace period; the hard-delete trigger.

## Cleanup job

`runRetentionCleanup` in `apps/worker/src/retention.ts`:

1. Finds submissions with `deleteAfter <= now` and `status != DELETED`.
2. Deletes the encrypted PDF blob from storage and the `EncryptedPdf` row.
3. Deletes all `Guest` rows (names, birth dates, addresses, encrypted document numbers).
4. Clears `guestEmail` and `guestPhone`.
5. Marks the submission `DELETED` — the anonymized shell (dates, purpose, property,
   requirementVersion) remains as a statistical/audit stub.
6. Writes a `RETENTION_DELETED_SUBMISSION` audit log.

The job is idempotent and covered by tests (`apps/worker/tests/retention.test.ts`).

## Implementation status

The cleanup job is fully implemented and tested. Two CLI entry-points are available:

```sh
# Preview: lists submission IDs that would be deleted — no DB or blob mutations
pnpm --filter @gr/worker retention:dry-run

# Execute: runs the full cleanup (blob delete → PII clear → DELETED status → audit)
pnpm --filter @gr/worker retention:run
```

Both commands load environment from `../../.env` via `dotenv-cli`.

## Production scheduling

**Recommended: Azure Container Apps Job**

Create a Container App Job with a cron schedule (e.g. `0 2 * * *` — 2 AM UTC daily) that
runs:

```sh
pnpm --filter @gr/worker retention:run
```

The job is idempotent — re-running it after a partial failure is safe.

**Alternative: Azure Functions Timer Trigger**

If the project already uses Azure Functions, a Timer Trigger with the same cron expression
works identically.

**Dev / local**

The long-running worker (`main.ts`) also runs `runRetentionCleanup` on startup and then
every `RETENTION_INTERVAL_HOURS` hours (default 24). This covers local development but is
not the recommended production mechanism — a dedicated scheduled job is easier to observe,
alert on, and replay independently of the Service Bus consumer.

## Remaining TODOs

- **TODO(legal): verify retention periods against official Finnish requirements** for
  accommodation records (majoitusilmoitus) and align `RETENTION_DEFAULT_DAYS`, the grace
  period, and the legal basis mapping before production use. The current values are
  engineering placeholders, not legal advice.
- Consider deletion certificates / reporting for data-subject requests (GDPR Art. 17).
