import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, downloadPdf } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import OwnerLayout from "./OwnerLayout.js";

type SubmissionDetail = {
  id: string;
  status: string;
  property: { id: string; name: string; city: string };
  arrivalDate: string;
  departureDate: string;
  purposeOfStay: string;
  requirementVersion: string;
  guestEmail: string | null;
  guestPhone: string | null;
  submittedAt: string;
  retainUntil: string;
  legalBasis: string;
  pdfAvailable: boolean;
  guests: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    nationality: string;
    documentType: string;
    isPrimaryGuest: boolean;
  }[];
};

export default function SubmissionDetailPage() {
  const { submissionId } = useParams<{ submissionId: string }>();
  const { token, user } = useOwnerAuth();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [error, setError] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SubmissionDetail>(`/v1/owner/submissions/${submissionId}`, token!)
      .then(setDetail)
      .catch(() => setError(true));
  }, [submissionId, token]);

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
              <Item label="Departure" value={detail.departureDate} />
              <Item label="Purpose" value={detail.purposeOfStay} />
              <Item label="Submitted" value={new Date(detail.submittedAt).toLocaleString()} />
              <Item label="Contact email" value={detail.guestEmail ?? "—"} />
              <Item label="Contact phone" value={detail.guestPhone ?? "—"} />
              <Item label="Requirement version" value={detail.requirementVersion} />
              <Item label="Retained until" value={detail.retainUntil.slice(0, 10)} />
            </dl>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Guests</h2>
            <ul className="space-y-2 text-sm">
              {detail.guests.map((guest) => (
                <li key={guest.id} className="rounded border border-slate-200 p-3">
                  <p className="font-medium">
                    {guest.firstName} {guest.lastName}
                    {guest.isPrimaryGuest && (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                        primary
                      </span>
                    )}
                  </p>
                  <p className="text-slate-500">
                    Born {guest.dateOfBirth} · {guest.nationality} · {guest.documentType}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-400">
              Document numbers are only available in the encrypted PDF.
            </p>
          </div>

          <div className="rounded-xl bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Registration PDF</h2>
            {downloadError && <p className="mb-2 text-sm text-red-600">{downloadError}</p>}
            {detail.pdfAvailable && canDownload ? (
              <button
                onClick={() =>
                  downloadPdf(detail.id, token!).catch(() =>
                    setDownloadError("Download failed."),
                  )
                }
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700"
              >
                Download PDF
              </button>
            ) : (
              <p className="text-sm text-slate-500">
                {!detail.pdfAvailable
                  ? "PDF is not ready yet."
                  : "Your role does not permit PDF downloads."}
              </p>
            )}
          </div>
        </div>
      )}
    </OwnerLayout>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </>
  );
}
