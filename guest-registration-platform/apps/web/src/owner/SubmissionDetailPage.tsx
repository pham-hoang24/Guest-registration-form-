import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, downloadCardPdf } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import OwnerLayout from "./OwnerLayout.js";

type CardGuest = {
  id: string;
  guestType: string;
  roleOnCard: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  citizenship: string | null;
  isAdult: boolean;
};

type PassengerCard = {
  id: string;
  cardNumber: number;
  cardType: string;
  status: string;
  submittedAt: string;
  countryOfEntryToFinland: string | null;
  countryOfEntryNotApplicableReason: string | null;
  pdfAvailable: boolean;
  guests: CardGuest[];
};

type SubmissionDetail = {
  id: string;
  status: string;
  property: { id: string; name: string; city: string };
  arrivalDate: string;
  departureDate: string | null;
  departureDateKnown: boolean;
  purposeOfStay: string | null;
  requirementVersion: string;
  submittedAt: string;
  retainUntil: string | null;
  legalBasis: string;
  batchReady: boolean;
  passengerCards: PassengerCard[];
  guestCount: number;
};

export default function SubmissionDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const { user } = useOwnerAuth();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SubmissionDetail>(`/v1/owner/submissions/${submissionId}`)
      .then(setDetail)
      .catch(() => setError(true));
  }, [submissionId]);

  const canDownload = user?.role === "OWNER" || user?.role === "MANAGER";

  return (
    <OwnerLayout title="Submission detail">
      {error && <p className="text-red-600">Failed to load submission.</p>}
      {!detail && !error && <p className="text-slate-500">Loading…</p>}
      {detail && (
        <div className="space-y-4">
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Stay</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <Item label="Property" value={`${detail.property.name}, ${detail.property.city}`} />
              <Item label="Status" value={detail.status} />
              <Item label="Arrival" value={detail.arrivalDate} />
              <Item label="Departure" value={detail.departureDate ?? "—"} />
              <Item label="Purpose" value={detail.purposeOfStay ?? "—"} />
              <Item label="Submitted" value={new Date(detail.submittedAt).toLocaleString()} />
              <Item label="Requirement version" value={detail.requirementVersion} />
              <Item label="Retained until" value={detail.retainUntil?.slice(0, 10) ?? "—"} />
            </dl>
          </div>

          {detail.passengerCards.map((card) => (
            <div key={card.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">
                  Passenger card {card.cardNumber}
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                    {card.cardType === "ADDITIONAL_ADULT_INDIVIDUAL"
                      ? "Additional adult"
                      : "Primary + family"}
                  </span>
                </h2>
                <span className="text-xs text-slate-400">{card.status}</span>
              </div>
              <ul className="space-y-2 text-sm">
                {card.guests.map((guest) => (
                  <li key={guest.id} className="rounded border border-slate-200 p-3">
                    <p className="font-medium">
                      {guest.firstName} {guest.lastName}
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                        {roleLabel(guest.roleOnCard)}
                      </span>
                    </p>
                    <p className="text-slate-500">
                      {guest.dateOfBirth ? `Born ${guest.dateOfBirth}` : "Identified by personal identity code"}
                      {guest.citizenship ? ` · Nationality ${guest.citizenship}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-400">
                Document numbers are only available in the encrypted PDF.
              </p>
              <div className="mt-3">
                {card.pdfAvailable && canDownload ? (
                  <button
                    onClick={() =>
                      downloadCardPdf(card.id).catch(() =>
                        setDownloadError("Download failed."),
                      )
                    }
                    className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
                  >
                    Download PDF
                  </button>
                ) : (
                  <p className="text-sm text-slate-500">
                    {!card.pdfAvailable
                      ? "PDF is not ready yet."
                      : "Your role does not permit PDF downloads."}
                  </p>
                )}
              </div>
            </div>
          ))}
          {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
        </div>
      )}
    </OwnerLayout>
  );
}

function roleLabel(role: string): string {
  if (role === "CARD_HOLDER") return "card holder";
  if (role === "SPOUSE") return "spouse";
  if (role === "MINOR_CHILD") return "minor child";
  return role;
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </>
  );
}
