const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

async function parseError(response: Response): Promise<never> {
  let code = "request_failed";
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) code = body.error;
  } catch {
    // non-JSON error body
  }
  throw new ApiError(response.status, code);
}

export async function apiGet<T>(path: string, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) await parseError(response);
  return response.json() as Promise<T>;
}

export async function apiAction(path: string, token?: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
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
export async function downloadCardPdf(passengerCardId: string, token: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/v1/owner/passenger-cards/${passengerCardId}/pdf`,
    { headers: { authorization: `Bearer ${token}` } },
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
