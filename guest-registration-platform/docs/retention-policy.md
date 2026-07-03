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

Run manually:

```
pnpm --filter @gr/worker retention
```

## Production TODOs

- **Schedule it** (cron, Azure Container Apps job, or Service-Bus-triggered) — the MVP only
  exposes the function and a manual command.
- **TODO(legal): verify retention periods against official Finnish requirements** for
  accommodation records (majoitusilmoitus) and align `RETENTION_DEFAULT_DAYS`, the grace
  period, and the legal basis mapping before production use. The current values are
  engineering placeholders, not legal advice.
- Consider deletion certificates / reporting for data-subject requests (GDPR Art. 17).
