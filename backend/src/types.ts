export type SubmissionStatus = "PENDING_PDF" | "READY" | "FAILED";

export type SubmissionRecord = {
  id: string;
  tenantId: string;
  propertyId: string;
  reservationId?: string | null;
  status: SubmissionStatus;
  /** Unencrypted display name stored for list endpoints. GDPR-sensitive: plaintext PII. */
  tenantName?: string | null;
  blobPath?: string | null;
  aadVersion: number;
  schemaVersion: number;
  attemptCount: number;
  lastError?: string | null;
  /** ROWVERSION token from SQL Server; represented as hex string by the db adapter. */
  rowVersion?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EncryptionMetadata = {
  submissionId: string;
  tenantId: string;
  propertyId: string;
  algo: "AES-256-GCM";
  nonce: string;
  tag: string;
  ciphertextSha256: string;
  contentType: string;
  contentLength: number;
  aadVersion: number;
  schemaVersion: number;
};

export type AuditEventType =
  | "submission_created"
  | "pdf_generated"
  | "pdf_encrypted"
  | "dek_wrapped"
  | "download_started"
  | "download_succeeded"
  | "download_denied"
  | "token_replay"
  | "token_invalid"
  | "decrypt_failed"
  | "keyvault_error"
  | "dek_rewrapped"
  | "pdf_ready"
  | "submission_failed"
  | "retention_deleted";

export type AuditLog = {
  id: string;
  eventType: AuditEventType;
  correlationId: string;
  actorType: "guest" | "owner" | "system";
  actorId: string;
  tenantId?: string | null;
  propertyId?: string | null;
  submissionId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  details?: Record<string, unknown>;
};

export type GuestTokenClaims = {
  tenantId: string;
  propertyId: string;
  reservationId?: string;
  jti: string;
  aud: string;
  exp: number;
  iat: number;
  iss?: string;
};

export type OwnerIdentity = {
  userId: string;
  tenantId: string;
  propertyIds: string[];
};
