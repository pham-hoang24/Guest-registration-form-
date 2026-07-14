import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { LINK_TTL_HOURS, type LinkTtlHours } from "@gr/shared";
import { ApiError, apiGet, apiPost } from "../api/client.js";

type Submission = {
  id: string;
  status: string;
  arrivalDate: string;
  departureDate: string | null;
  cardCount: number;
};

type LinkResult = {
  url: string;
  createdAt: string;
  expiresAt: string;
  linkTtlHours: number;
};

/**
 * Create / replace the single active registration link for a property.
 *
 * The one-time URL and its QR live in React memory only — never localStorage,
 * sessionStorage, or analytics — and are dropped when the dialog closes. After a
 * refresh the property card shows only status/dates/counts, never the raw URL.
 */
export default function RegistrationLinkDialog({
  propertyId,
  propertyName,
  onClose,
}: {
  propertyId: string;
  propertyName: string;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<Submission | null | undefined>(undefined);
  const [arrivalDate, setArrivalDate] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [maxPassengerCards, setMaxPassengerCards] = useState(20);
  const [linkTtlHours, setLinkTtlHours] = useState<LinkTtlHours>(48);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LinkResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Load the property's current OPEN session so the confirmation shows what
  // this replacement will close.
  useEffect(() => {
    let active = true;
    apiGet<{ submissions: Submission[] }>(`/v1/owner/properties/${propertyId}/submissions`)
      .then((data) => {
        if (active) setCurrent(data.submissions.find((s) => s.status === "OPEN") ?? null);
      })
      .catch(() => {
        if (active) setCurrent(null);
      });
    return () => {
      active = false;
    };
  }, [propertyId]);

  // Render the QR in memory once a link exists.
  useEffect(() => {
    if (!result) return;
    let active = true;
    QRCode.toDataURL(result.url, { width: 256, margin: 1 })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [result]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<LinkResult>(
        `/v1/owner/properties/${propertyId}/active-registration-link`,
        { arrivalDate, departureDate, maxPassengerCards, linkTtlHours },
      );
      setResult(created);
    } catch (error) {
      // #region agent log
      fetch("http://127.0.0.1:7593/ingest/0b44e68a-d6ba-48b1-8f82-e6525231d7b1", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "fd0723" },
        body: JSON.stringify({
          sessionId: "fd0723",
          location: "RegistrationLinkDialog.tsx:onSubmit",
          message: "link create catch",
          data: {
            hypothesisId: "F",
            runId: "post-fix-link",
            status: error instanceof ApiError ? error.status : null,
            code: error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setError("Could not create the link. Check the dates and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function downloadQr() {
    if (!qrDataUrl) return;
    const anchor = document.createElement("a");
    anchor.href = qrDataUrl;
    // Neutral filename — no guest / property / token / date / id.
    anchor.download = "registration-link-qr.png";
    anchor.click();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900">Registration link — {propertyName}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">
            ✕
          </button>
        </div>

        {result ? (
          <div>
            <p className="mb-3 rounded bg-amber-50 p-2 text-sm font-medium text-amber-800">
              Save this link now. It will not be shown again.
            </p>
            <label className="mb-1 block text-sm font-medium text-slate-700">Registration URL</label>
            <div className="mb-2 flex gap-2">
              <input
                readOnly
                value={result.url}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                onClick={copyUrl}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Expires {new Date(result.expiresAt).toLocaleString()}.
            </p>
            {qrDataUrl && (
              <div className="mb-4 flex flex-col items-center">
                <img src={qrDataUrl} alt="Registration link QR code" className="h-56 w-56" />
                <button
                  onClick={downloadQr}
                  className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download QR (PNG)
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-slate-800 px-4 py-2 font-semibold text-white hover:bg-slate-900"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="mb-3 rounded bg-slate-50 p-3 text-sm text-slate-600">
              {current === undefined && "Loading current session…"}
              {current === null && "No active registration session for this property yet."}
              {current && (
                <>
                  <span className="font-medium text-slate-800">Current session:</span> arrival{" "}
                  {current.arrivalDate}
                  {current.departureDate ? ` → ${current.departureDate}` : ""}, {current.cardCount}{" "}
                  card{current.cardCount === 1 ? "" : "s"} submitted.
                </>
              )}
              <p className="mt-1 text-amber-700">
                This closes the current registration session and disables the old link.
              </p>
            </div>

            {error && <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{error}</div>}

            <label className="mb-1 block text-sm font-medium text-slate-700">Arrival date</label>
            <input
              type="date"
              value={arrivalDate}
              onChange={(e) => setArrivalDate(e.target.value)}
              required
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">Departure date</label>
            <input
              type="date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
              required
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">
              Max passenger cards
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={maxPassengerCards}
              onChange={(e) => setMaxPassengerCards(Number(e.target.value))}
              required
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2"
            />

            <label className="mb-1 block text-sm font-medium text-slate-700">Link lifetime</label>
            <select
              value={linkTtlHours}
              onChange={(e) => setLinkTtlHours(Number(e.target.value) as LinkTtlHours)}
              className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              {LINK_TTL_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create / replace link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
