import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Button, ErrorSummary, Spinner } from "../components";
import {
  fetchSubmissions,
  downloadPdf,
  createGuestToken,
} from "../api/endpoints";
import { ApiError } from "../api/client";
import { toUserMessage } from "../api/errors";
import { useOwnerAuth } from "../contexts/OwnerAuth";
import { config } from "../config";

export function SubmissionsList() {
  const { propertyId } = useParams<{ propertyId: string }>();
  const { token, isAuthenticated } = useOwnerAuth();
  const [submissions, setSubmissions] = useState<
    Array<{ id: string; createdAt: string; status: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [guestLink, setGuestLink] = useState<string | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);

  useEffect(() => {
    if (!propertyId || !token) {
      setLoading(false);
      if (!isAuthenticated) setError(toUserMessage("unauthorized"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchSubmissions(propertyId, token)
      .then((res) => {
        if (!cancelled) setSubmissions(res.submissions ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          const msg =
            e instanceof ApiError
              ? toUserMessage(e.code)
              : "Failed to load submissions.";
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, token, isAuthenticated]);

  const handleCreateGuestLink = useCallback(async () => {
    if (!propertyId || !token) return;
    setCreatingLink(true);
    setGuestLink(null);
    setError(null);
    try {
      const res = await createGuestToken(propertyId, token);
      const link = `${config.appBaseUrl}/register/${encodeURIComponent(
        res.token
      )}`;
      setGuestLink(link);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? toUserMessage(e.code)
          : "Failed to create link.";
      setError(msg);
    } finally {
      setCreatingLink(false);
    }
  }, [propertyId, token]);

  const handleCopyLink = useCallback(() => {
    if (!guestLink) return;
    void navigator.clipboard.writeText(guestLink);
  }, [guestLink]);

  const handleDownload = useCallback(
    async (submissionId: string) => {
      if (!token) return;
      setDownloading(submissionId);
      try {
        const blob = await downloadPdf(submissionId, token);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `registration_${submissionId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        const msg =
          e instanceof ApiError ? toUserMessage(e.code) : "Download failed.";
        setError(msg);
      } finally {
        setDownloading(null);
      }
    },
    [token]
  );

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-xl font-semibold text-gray-900">
            Sign in required
          </h1>
          <p className="mt-2 text-gray-600">
            Set VITE_DEV_OWNER_TOKEN in .env to access the owner dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (!propertyId) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="text-xl font-semibold text-gray-900">
            Invalid property
          </h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-xl font-semibold text-gray-900">Submissions</h1>
        <p className="mt-1 text-sm text-gray-500">Property: {propertyId}</p>

        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-medium text-gray-900">
            Create guest link
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Generate a link for guests to register. This link is sensitive.
          </p>
          <Button
            variant="secondary"
            onClick={handleCreateGuestLink}
            loading={creatingLink}
            disabled={creatingLink}
            className="mt-2"
          >
            Create guest link
          </Button>
          {guestLink && (
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={guestLink}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <Button variant="secondary" onClick={handleCopyLink}>
                  Copy
                </Button>
              </div>
              <div className="flex justify-center p-2 bg-white rounded">
                <QRCodeSVG value={guestLink} size={128} level="M" />
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="mt-6 flex justify-center py-8" aria-live="polite">
            <Spinner aria-label="Loading submissions" />
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorSummary errors={[error]} title="" />
          </div>
        )}

        {!loading && !error && submissions.length === 0 && (
          <p className="mt-6 text-gray-500">No submissions yet.</p>
        )}

        {!loading && submissions.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    ID
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Created
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {s.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="secondary"
                        onClick={() => handleDownload(s.id)}
                        loading={downloading === s.id}
                        disabled={!!downloading || s.status !== "READY"}
                      >
                        Download PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
