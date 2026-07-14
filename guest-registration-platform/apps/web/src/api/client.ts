const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }
}

// CSRF token bound to the owner session. Held in memory ONLY (never localStorage):
// issued by login / GET /me and echoed as X-CSRF-Token on every owner mutation.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

function withCsrf(headers: Record<string, string> = {}): Record<string, string> {
  return csrfToken ? { ...headers, "x-csrf-token": csrfToken } : headers;
}

async function parseError(response: Response): Promise<never> {
  let code = "request_failed";
  let details: unknown;
  try {
    const body = (await response.json()) as { error?: string; details?: unknown };
    if (body.error) code = body.error;
    if (body.details !== undefined) details = body.details;
  } catch {
    // non-JSON error body
  }
  throw new ApiError(response.status, code, details);
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: withCsrf({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: withCsrf({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiAction(path: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: withCsrf(),
  });
  if (!response.ok) await parseError(response);
}

/**
 * Posts a multipart/form-data body (the `payload` JSON field + one PNG file per
 * signing adult). The browser sets the multipart boundary Content-Type itself.
 */
export async function apiPostMultipart<T>(path: string, form: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST", body: form });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

/** Fetches a decrypted passenger-card PDF and triggers a browser download. */
export async function downloadCardPdf(passengerCardId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/v1/owner/passenger-cards/${passengerCardId}/pdf`,
    { credentials: "include" },
  );
  if (!response.ok) await parseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `passenger-card-${passengerCardId}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}
