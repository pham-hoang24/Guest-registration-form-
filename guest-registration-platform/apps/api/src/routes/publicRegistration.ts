import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { encryptString, hashRegistrationToken, computeCardFingerprint } from "@gr/crypto";
import { writeAudit } from "@gr/db";
import { REQUIREMENT_VERSION, SUPPORTED_LANGUAGES, NORDIC_CITIZENSHIPS } from "@gr/shared";
import type { AppDeps } from "../deps.js";
import { buildPassengerCards, DomainValidationError } from "../domain/buildPassengerCards.js";
import { normalizeFinnishPhone } from "../domain/phone.js";
import { payloadSchema } from "../domain/submissionSchema.js";
import { sendError } from "../lib/httpErrors.js";
import { auditMetaFromRequest } from "../lib/requestMeta.js";
import { publicGetRateLimit, publicPostRateLimit, publicPostHourlyRateLimit } from "../middleware/rateLimit.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_SIGNATURE_BYTES = 200 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const NORDIC = new Set<string>(NORDIC_CITIZENSHIPS);

/**
 * Country-of-entry is legally required unless the card holder is a Nordic citizen
 * or resident in Finland — in which case we persist the explicit reason instead
 * of a silent null (validated at the schema level).
 */
function deriveCountryOfEntry(holder: {
  citizenship?: string | null;
  isResidentInFinland?: boolean | null;
  countryOfEntryToFinland?: string | null;
}): { countryOfEntryToFinland: string | null; countryOfEntryNotApplicableReason: string | null } {
  const country = holder.countryOfEntryToFinland ?? null;
  if (country) {
    return { countryOfEntryToFinland: country, countryOfEntryNotApplicableReason: null };
  }
  if (holder.isResidentInFinland) {
    return { countryOfEntryToFinland: null, countryOfEntryNotApplicableReason: "RESIDENT_IN_FINLAND" };
  }
  if (holder.citizenship && NORDIC.has(holder.citizenship)) {
    return { countryOfEntryToFinland: null, countryOfEntryNotApplicableReason: "NORDIC_CITIZEN" };
  }
  return { countryOfEntryToFinland: null, countryOfEntryNotApplicableReason: null };
}

function isPngMagic(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_MAGIC);
}

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

type ResolvedLink = {
  link: { id: string; tenantId: string; propertyId: string; property: { name: string; city: string } };
  stay: {
    id: string;
    arrivalDate: Date;
    departureDate: Date | null;
    departureDateKnown: boolean;
    purposeOfStay: string | null;
    requirementVersion: string;
    maxPassengerCards: number;
    retainUntil: Date | null;
    deleteAfter: Date | null;
  };
};

type ResolveLinkResult =
  | { kind: "not_found" }
  | { kind: "unavailable" }
  | { kind: "ok" } & ResolvedLink;

async function resolveActiveLink(
  db: AppDeps["db"],
  rawToken: string | undefined,
): Promise<ResolveLinkResult> {
  if (!rawToken || rawToken.length > 200) return { kind: "not_found" };
  const link = await db.registrationLink.findUnique({
    where: { tokenHash: hashRegistrationToken(rawToken) },
    include: {
      property: { select: { name: true, city: true } },
      tenant: { select: { status: true } },
      guestSubmission: {
        select: {
          id: true,
          status: true,
          arrivalDate: true,
          departureDate: true,
          departureDateKnown: true,
          purposeOfStay: true,
          requirementVersion: true,
          maxPassengerCards: true,
          retainUntil: true,
          deleteAfter: true,
        },
      },
    },
  });
  if (!link) return { kind: "not_found" };
  if (link.status !== "ACTIVE") return { kind: "unavailable" };
  if (link.tenant.status !== "ACTIVE") return { kind: "unavailable" };
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return { kind: "unavailable" };
  if (!link.guestSubmission || link.guestSubmission.status !== "OPEN") return { kind: "unavailable" };
  return { kind: "ok", link, stay: link.guestSubmission };
}

export function publicRegistrationRoutes(deps: AppDeps): Router {
  const router = Router();
  const { db, config } = deps;

  // Multer with memory storage for signature PNGs.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_SIGNATURE_BYTES,
      fieldSize: 100 * 1024,
    },
  });

  router.get("/registration-links/:token", async (req, res, next) => {
    const rawToken = req.params.token;
    const hashedToken = hashRegistrationToken(rawToken ?? "");
    const limiter = publicGetRateLimit(config, hashedToken);

    limiter(req, res, async () => {
      try {
        const resolved = await resolveActiveLink(db, rawToken);
        if (resolved.kind === "not_found") {
          sendError(res, 404, "registration_link_not_found");
          return;
        }
        if (resolved.kind === "unavailable") {
          sendError(res, 410, "registration_link_unavailable");
          return;
        }
        const { link } = resolved;

        // Lightweight structured log only — not an audit table row.
        console.log(
          JSON.stringify({
            level: "info",
            event: "registration_link_opened",
            requestId: req.requestId,
            tenantId: link.tenantId,
            propertyId: link.propertyId,
          }),
        );

        res.json({
          propertyName: link.property.name,
          propertyCity: link.property.city,
          requirementVersion: REQUIREMENT_VERSION,
          supportedLanguages: SUPPORTED_LANGUAGES,
        });
      } catch (error) {
        next(error);
      }
    });
  });

  router.post(
    "/registration-links/:token/submissions",
    upload.any(),
    async (req, res, next) => {
      const rawToken = req.params.token;
      const hashedToken = hashRegistrationToken(rawToken ?? "");

      // Apply per-IP+token and per-token hourly limits.
      const minuteLimiter = publicPostRateLimit(config, hashedToken);
      const hourlyLimiter = publicPostHourlyRateLimit(config, hashedToken);

      minuteLimiter(req, res, (minuteErr) => {
        if (minuteErr) return next(minuteErr);
        hourlyLimiter(req, res, (hourlyErr) => {
          if (hourlyErr) return next(hourlyErr);
          handleSubmit(req, res, next, rawToken);
        });
      });
    },
  );

  async function handleSubmit(
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
    rawToken: string | undefined,
  ) {
    try {
      // 1. Resolve link + stay.
      const resolved = await resolveActiveLink(db, rawToken);
      if (resolved.kind === "not_found") {
        sendError(res, 404, "registration_link_not_found");
        return;
      }
      if (resolved.kind === "unavailable") {
        sendError(res, 410, "registration_link_unavailable");
        return;
      }
      const { link, stay } = resolved;

      // 2. Parse `payload` JSON field from the multipart body.
      let rawPayload: unknown;
      try {
        const payloadField = (req.body as Record<string, unknown>).payload;
        if (typeof payloadField !== "string") {
          sendError(res, 400, "validation_failed", { payload: ["payload field is required"] });
          return;
        }
        rawPayload = JSON.parse(payloadField);
      } catch {
        sendError(res, 400, "validation_failed", { payload: ["payload must be valid JSON"] });
        return;
      }

      // 3. Zod validate.
      const parsed = payloadSchema.safeParse(rawPayload);
      if (!parsed.success) {
        sendError(res, 400, "validation_failed", parsed.error.flatten().fieldErrors);
        return;
      }
      const payload = parsed.data;

      // 4. Confirm stay fields match the pre-created GuestSubmission.
      // Departure is nullable (unknown-departure stays); compare the known-flag
      // and the date (both null when unknown).
      const stayDeparture = stay.departureDate
        ? stay.departureDate.toISOString().slice(0, 10)
        : null;
      if (
        payload.arrivalDate !== stay.arrivalDate.toISOString().slice(0, 10) ||
        payload.departureDateKnown !== stay.departureDateKnown ||
        (payload.departureDate ?? null) !== stayDeparture ||
        (stay.purposeOfStay && payload.purposeOfStay !== stay.purposeOfStay)
      ) {
        sendError(res, 409, "stay_fields_mismatch");
        return;
      }

      // 5. Build passenger card drafts.
      let cardDrafts: import("../domain/buildPassengerCards.js").PassengerCardDraft[];
      try {
        cardDrafts = buildPassengerCards(payload.people);
      } catch (err) {
        if (err instanceof DomainValidationError) {
          sendError(res, 400, "validation_failed", { people: [err.message] });
          return;
        }
        throw err;
      }

      // 6. Strictly validate signature files: one per card, exact field names, PNG magic, size.
      const expectedSignatureFields = new Set(cardDrafts.map((c) => c.signatureField));
      const files = (req.files as Express.Multer.File[]) ?? [];

      // Reject unexpected fields.
      for (const file of files) {
        if (!expectedSignatureFields.has(file.fieldname)) {
          sendError(res, 400, "invalid_signature_field", {
            signature: [`Unexpected field: ${file.fieldname}`],
          });
          return;
        }
      }

      // Check for missing, duplicate, or invalid signatures.
      const filesByField = new Map<string, Express.Multer.File>();
      for (const file of files) {
        if (filesByField.has(file.fieldname)) {
          sendError(res, 400, "duplicate_signature_field", {
            signature: [`Duplicate field: ${file.fieldname}`],
          });
          return;
        }
        filesByField.set(file.fieldname, file);
      }

      for (const field of expectedSignatureFields) {
        const file = filesByField.get(field);
        if (!file) {
          sendError(res, 400, "missing_signature", { signature: [`Missing: ${field}`] });
          return;
        }
        if (!isPngMagic(file.buffer)) {
          sendError(res, 400, "invalid_signature_format", {
            signature: [`${field} is not a valid PNG`],
          });
          return;
        }
        if (file.buffer.length > MAX_SIGNATURE_BYTES) {
          sendError(res, 400, "signature_too_large", {
            signature: [`${field} exceeds 200KB`],
          });
          return;
        }
      }

      // 7. Normalize phones and compute per-card HMAC fingerprints.
      const pepper = config.fingerprintPepper;
      const cardPrepared = cardDrafts.map((draft) => {
        const fingerprint = computeCardFingerprint(
          {
            cardType: draft.cardType,
            guests: draft.people.map((p) => ({
              guestType: p.guestType,
              roleOnCard: p.guestType,
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: p.dateOfBirth,
              citizenship: "citizenship" in p ? p.citizenship : undefined,
              documentType: "documentType" in p ? p.documentType : undefined,
              documentNumber: "documentNumber" in p ? p.documentNumber : undefined,
            })),
          },
          pepper,
        );
        return { draft, fingerprint, signatureFile: filesByField.get(draft.signatureField)! };
      });

      // 8. Transactional insert with row-lock to enforce maxPassengerCards.
      const primaryPerson = payload.people.find((p) => p.guestType === "primary")!;
      let primaryPhone: string | undefined;
      if ("phone" in primaryPerson && primaryPerson.phone) {
        try {
          primaryPhone = normalizeFinnishPhone(primaryPerson.phone);
        } catch {
          sendError(res, 400, "validation_failed", {
            people: ["Primary guest phone number is invalid"],
          });
          return;
        }
      }

      type TxResult =
        | { kind: "exact_duplicate"; cardIds: string[] }
        | { kind: "partial_overlap" }
        | { kind: "capacity_exceeded" }
        | { kind: "inserted"; cardIds: string[] };

      const incomingFingerprints = cardPrepared.map((c) => c.fingerprint);

      let txResult: TxResult;
      try {
        txResult = await db.$transaction(async (tx) => {
          // Row-lock the stay to prevent concurrent over-insertion.
          await tx.$queryRaw`SELECT id FROM "GuestSubmission" WHERE id = ${stay.id} FOR UPDATE`;

          // Load existing fingerprints.
          const existing = await tx.passengerCard.findMany({
            where: { guestSubmissionId: stay.id },
            select: { id: true, submissionFingerprint: true },
          });
          const existingFingerprintMap = new Map(existing.map((c) => [c.submissionFingerprint, c.id]));

          const matchingIds = incomingFingerprints
            .map((fp) => existingFingerprintMap.get(fp))
            .filter((id): id is string => id !== undefined);

          // Classify: all match = exact duplicate; some match = partial overlap; none = new.
          if (matchingIds.length === incomingFingerprints.length) {
            return { kind: "exact_duplicate", cardIds: matchingIds };
          }
          if (matchingIds.length > 0) {
            return { kind: "partial_overlap" };
          }

          // Enforce maxPassengerCards under the lock.
          if (existing.length + cardPrepared.length > stay.maxPassengerCards) {
            return { kind: "capacity_exceeded" };
          }

          // Determine the next card number.
          let cardNumber = existing.length + 1;
          const insertedCardIds: string[] = [];

          // Set retainUntil / deleteAfter on first submit if not yet set.
          if (!stay.retainUntil) {
            const now = new Date();
            const retainUntil = new Date(now.getTime() + deps.config.retentionDefaultDays * DAY_MS);
            const deleteAfter = new Date(retainUntil.getTime() + deps.config.retentionGraceDays * DAY_MS);
            await tx.guestSubmission.update({
              where: { id: stay.id },
              data: {
                retainUntil,
                deleteAfter,
                primaryGuestName: [primaryPerson.firstName, primaryPerson.lastName].join(" "),
                primaryGuestEmail: "email" in primaryPerson ? primaryPerson.email ?? null : null,
                primaryGuestPhoneE164: primaryPhone ?? null,
              },
            });
          }

          for (const { draft, fingerprint, signatureFile } of cardPrepared) {
            const cardId = randomUUID();

            // Build guests with pre-generated IDs so AAD is fully known before encryption.
            const guestRows = await Promise.all(
              draft.people.map(async (person) => {
                const guestId = randomUUID();
                const isAdult =
                  person.guestType === "primary" || person.guestType === "additional_adult";

                const context = {
                  tenantId: link.tenantId,
                  propertyId: link.propertyId,
                  guestSubmissionId: stay.id,
                  passengerCardId: cardId,
                  guestId,
                };

                let documentNumberEncrypted: string | undefined;
                let finnishPersonalIdentityCodeEncrypted: string | undefined;

                if ("documentNumber" in person && person.documentNumber) {
                  documentNumberEncrypted = await encryptString({
                    plaintext: person.documentNumber,
                    context: { ...context, field: "documentNumber" },
                    kms: deps.kms,
                  });
                }

                if ("finnishPersonalIdentityCode" in person && person.finnishPersonalIdentityCode) {
                  finnishPersonalIdentityCodeEncrypted = await encryptString({
                    plaintext: person.finnishPersonalIdentityCode,
                    context: { ...context, field: "finnishPersonalIdentityCode" },
                    kms: deps.kms,
                  });
                }

                let phoneE164: string | undefined;
                if ("phone" in person && person.phone) {
                  try {
                    phoneE164 = normalizeFinnishPhone(person.phone);
                  } catch {
                    // Non-fatal: store null if normalization fails for non-primary.
                  }
                }

                return {
                  id: guestId,
                  tenantId: link.tenantId,
                  propertyId: link.propertyId,
                  guestType: person.guestType,
                  roleOnCard: person.guestType,
                  firstName: person.firstName,
                  lastName: person.lastName,
                  dateOfBirth: new Date(`${person.dateOfBirth}T00:00:00Z`),
                  citizenship: "citizenship" in person ? person.citizenship ?? null : null,
                  isResidentInFinland:
                    "isResidentInFinland" in person ? person.isResidentInFinland : null,
                  address: "address" in person ? person.address ?? null : null,
                  documentType: "documentType" in person ? person.documentType ?? null : null,
                  documentNumberEncrypted: documentNumberEncrypted ?? null,
                  finnishPersonalIdentityCodeEncrypted:
                    finnishPersonalIdentityCodeEncrypted ?? null,
                  email: "email" in person ? person.email ?? null : null,
                  phoneE164: phoneE164 ?? null,
                  isAdult,
                };
              }),
            );

            // Encrypt signature PNG bytes (stored as base64 string).
            const signatureB64 = signatureFile.buffer.toString("base64");
            const signatureSha256 = sha256Hex(signatureFile.buffer);
            const ipHash = sha256Hex(req.ip ?? "");
            const uaHash = sha256Hex(req.headers["user-agent"] ?? "");

            const signatureEncrypted = await encryptString({
              plaintext: signatureB64,
              context: {
                tenantId: link.tenantId,
                propertyId: link.propertyId,
                guestSubmissionId: stay.id,
                passengerCardId: cardId,
                guestId: cardId, // card-level context for the signature
                field: "signature",
              },
              kms: deps.kms,
            });

            // Get primary guest name for the card holder.
            const primaryGuest = draft.people.find((p) => p.guestType === "primary");
            const cardHolderName = primaryGuest
              ? `${primaryGuest.firstName} ${primaryGuest.lastName}`
              : undefined;

            // Country-of-entry (and its not-applicable reason) come from the card
            // holder — the primary on the family card, the adult on their own card.
            const holder = draft.people[0]!;
            const { countryOfEntryToFinland, countryOfEntryNotApplicableReason } =
              deriveCountryOfEntry({
                citizenship: "citizenship" in holder ? holder.citizenship : null,
                isResidentInFinland:
                  "isResidentInFinland" in holder ? holder.isResidentInFinland : null,
                countryOfEntryToFinland:
                  "countryOfEntryToFinland" in holder ? holder.countryOfEntryToFinland : null,
              });

            await tx.passengerCard.create({
              data: {
                id: cardId,
                guestSubmissionId: stay.id,
                tenantId: link.tenantId,
                propertyId: link.propertyId,
                cardNumber: cardNumber++,
                cardType: draft.cardType,
                countryOfEntryToFinland,
                countryOfEntryNotApplicableReason,
                submissionFingerprint: fingerprint,
                requirementVersion: REQUIREMENT_VERSION,
                cardHolderName: cardHolderName ?? null,
                cardHolderEmail:
                  "email" in (primaryGuest ?? {})
                    ? (primaryGuest as { email?: string }).email ?? null
                    : null,
                cardHolderPhoneE164: primaryPhone ?? null,
                guests: { create: guestRows },
                signature: {
                  create: {
                    tenantId: link.tenantId,
                    propertyId: link.propertyId,
                    signatureEncrypted,
                    signatureSha256,
                    signedIpHash: ipHash,
                    signedUserAgentHash: uaHash,
                  },
                },
                pdfJob: {
                  create: {
                    tenantId: link.tenantId,
                    propertyId: link.propertyId,
                    status: "PENDING",
                  },
                },
              },
            });

            insertedCardIds.push(cardId);
          }

          return { kind: "inserted", cardIds: insertedCardIds };
        });
      } catch (err: unknown) {
        // P2002 = unique constraint violation — race condition caught at DB level.
        if (
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "P2002"
        ) {
          const existingCards = await db.passengerCard.findMany({
            where: {
              guestSubmissionId: stay.id,
              submissionFingerprint: { in: incomingFingerprints },
            },
            select: { id: true, submissionFingerprint: true },
          });
          if (existingCards.length === incomingFingerprints.length) {
            res.status(200).json({
              duplicate: true,
              cardIds: incomingFingerprints.map(
                (fp) => existingCards.find((c) => c.submissionFingerprint === fp)!.id,
              ),
            });
            return;
          }
          sendError(res, 409, "partial_duplicate_submission");
          return;
        }
        throw err;
      }

      // 9. Response + audit.
      if (txResult.kind === "exact_duplicate") {
        await writeAudit(db, {
          tenantId: link.tenantId,
          actorType: "GUEST",
          action: "PASSENGER_CARD_SUBMITTED",
          resourceType: "PassengerCard",
          resourceId: stay.id,
          ...auditMetaFromRequest(req),
          metadata: { duplicate: true, stayId: stay.id },
        });
        res.status(200).json({ duplicate: true, cardIds: txResult.cardIds });
        return;
      }

      if (txResult.kind === "partial_overlap") {
        sendError(res, 409, "partial_duplicate_submission");
        return;
      }

      if (txResult.kind === "capacity_exceeded") {
        sendError(res, 409, "max_passenger_cards_exceeded");
        return;
      }

      // All new — write audit rows.
      for (const cardId of txResult.cardIds) {
        await writeAudit(db, {
          tenantId: link.tenantId,
          actorType: "GUEST",
          action: "PASSENGER_CARD_SUBMITTED",
          resourceType: "PassengerCard",
          resourceId: cardId,
          ...auditMetaFromRequest(req),
          metadata: { stayId: stay.id, registrationLinkId: link.id },
        });
        await writeAudit(db, {
          tenantId: link.tenantId,
          actorType: "GUEST",
          action: "GUEST_SIGNATURE_SUBMITTED",
          resourceType: "PassengerCard",
          resourceId: cardId,
          ...auditMetaFromRequest(req),
          metadata: { stayId: stay.id },
        });
        await writeAudit(db, {
          tenantId: link.tenantId,
          actorType: "SYSTEM",
          action: "PDF_JOB_CREATED",
          resourceType: "PdfJob",
          resourceId: cardId,
          metadata: { stayId: stay.id, status: "PENDING" },
        });
      }

      // Hand off one PDF generation job per new passenger card.
      for (const cardId of txResult.cardIds) {
        await deps.queue.enqueuePdfJob({
          tenantId: link.tenantId,
          propertyId: link.propertyId,
          passengerCardId: cardId,
        });
      }

      res.status(201).json({ duplicate: false, cardIds: txResult.cardIds });
    } catch (error) {
      next(error);
    }
  }

  return router;
}
