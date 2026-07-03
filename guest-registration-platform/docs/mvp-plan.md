# MVP Plan and Status

## Delivered in this MVP

- [x] Monorepo (pnpm workspaces): apps/api, apps/worker, apps/web; packages/shared, db,
      crypto, pdf, storage
- [x] Prisma schema: Tenant, OwnerUser, Property, RegistrationLink, GuestSubmission,
      Guest, EncryptedPdf, AuditLog + enums; initial migration committed
- [x] Guest flow: token lookup → validated submission → encrypted document numbers →
      PDF generated, envelope-encrypted (AES-256-GCM + wrapped DEK + AAD), stored
- [x] Owner flow: login (bcrypt + JWT) → properties → submissions → detail →
      role-gated decrypted PDF download
- [x] Audit logging for all eight required events, PII-free with hashed IP/UA
- [x] Retention fields + testable cleanup job + manual runner
- [x] Compliance versioning: `FI-ACCOMMODATION-2026-01` stamped and AAD-bound
- [x] Tests: 52 passing (crypto tamper suite, API tenant isolation/RBAC/audit,
      validation, retention, storage traversal, PDF)
- [x] Docs: architecture, threat model, API, data model, security, retention
- [x] Seed script printing dev credentials + one-time registration URL

## Deliberately out of scope

Microservices, billing, PMS integrations, custom form builders, AI features,
dashboard polish beyond the secure end-to-end flow.

## Known gaps before production

1. Azure providers (Key Vault `KmsProvider`, Blob `StorageProvider`) — interfaces ready.
2. Retention job scheduling.
3. Multiple guests per submission in the web form (schema + API already support 1–20;
   the form captures the primary guest only).
4. Token revocation / refresh tokens; account lockout.
5. Postgres row-level security as a second isolation layer.
6. **TODO(legal): verify Finnish accommodation registration requirements
   (field set, retention, authority delivery format) against official sources.**

## Next 5 recommended tasks

1. Implement `AzureKeyVaultKmsProvider` + `AzureBlobStorageProvider` and wire
   `KMS_PROVIDER=azure` / `STORAGE_PROVIDER=azure`.
2. Move PDF generation behind a queue (Azure Service Bus) with retry + poison handling;
   schedule `runRetentionCleanup`.
3. Multi-guest UI (useFieldArray) + fi/sv translations of the guest form.
4. Owner user management (invite, disable, role change) with corresponding audit events.
5. CI pipeline: typecheck + tests against a service container Postgres; add ESLint.
