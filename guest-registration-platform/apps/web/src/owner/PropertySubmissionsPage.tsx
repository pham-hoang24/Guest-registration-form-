import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet } from "../api/client.js";
import { useOwnerAuth } from "./OwnerAuthContext.js";
import OwnerLayout from "./OwnerLayout.js";

type SubmissionRow = {
  id: string;
  status: string;
  arrivalDate: string;
  departureDate: string;
  purposeOfStay: string;
  submittedAt: string;
  guestCount: number;
};

type Response = {
  property: { id: string; name: string };
  submissions: SubmissionRow[];
};

export default function PropertySubmissionsPage() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { token } = useOwnerAuth();
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<Response>(`/v1/owner/properties/${propertyId}/submissions`, token!)
      .then(setData)
      .catch(() => setError(true));
  }, [propertyId, token]);

  return (
    <OwnerLayout title={data ? `Submissions — ${data.property.name}` : "Submissions"}>
      {error && <p className="text-red-600">Failed to load submissions.</p>}
      {!data && !error && <p className="text-slate-500">Loading…</p>}
      {data && data.submissions.length === 0 && (
        <p className="text-slate-500">No submissions yet.</p>
      )}
      {data && data.submissions.length > 0 && (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3">Stay</th>
                <th className="px-4 py-3">Guests</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.submissions.map((submission) => (
                <tr key={submission.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {submission.arrivalDate} → {submission.departureDate}
                  </td>
                  <td className="px-4 py-3">{submission.guestCount}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={submission.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/owner/submissions/${submission.id}`}
                      className="text-blue-700 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OwnerLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PDF_READY: "bg-green-100 text-green-800",
    RECEIVED: "bg-yellow-100 text-yellow-800",
    FAILED: "bg-red-100 text-red-800",
    DELETED: "bg-slate-100 text-slate-500",
  };
  return (
    <span className={`rounded px-2 py-1 text-xs font-medium ${colors[status] ?? "bg-slate-100"}`}>
      {status}
    </span>
  );
}
