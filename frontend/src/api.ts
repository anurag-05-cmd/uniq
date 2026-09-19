const base = "/api/v1";
let csrf: { token: string; headerName: string } | null = null;
let csrfPromise: Promise<{ token: string; headerName: string }> | null = null;
// Ambiguous transport failures retain the key. A retry of the same intent is safe.
const pendingIntents = new Map<string, string>();
// getRandomValues is available on HTTP LAN pages, unlike randomUUID.
function newIntentKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
export function clearSession() {
  csrf = null;
  csrfPromise = null;
  pendingIntents.clear();
}
export async function getCsrf() {
  if (csrf) return csrf;
  if (!csrfPromise)
    csrfPromise = fetch(base + "/auth/csrf", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    })
      .then(async (response) => {
        if (!response.ok)
          throw new ApiError(
            response.status,
            "Unable to establish a secure session. Please retry.",
          );
        csrf = await response.json();
        return csrf!;
      })
      .finally(() => {
        csrfPromise = null;
      });
  return csrfPromise;
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const mutating = method !== "GET";
  const form = body instanceof URLSearchParams;
  const encoded =
    body === undefined
      ? undefined
      : form
        ? body.toString()
        : JSON.stringify(body);
  const intent = `${method}:${path}:${encoded ?? ""}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (encoded !== undefined)
    headers["Content-Type"] = form
      ? "application/x-www-form-urlencoded"
      : "application/json";
  if (mutating) {
    const token = await getCsrf();
    headers[token.headerName] = token.token;
    if (!pendingIntents.has(intent)) pendingIntents.set(intent, newIntentKey());
    headers["Idempotency-Key"] = pendingIntents.get(intent)!;
  }
  let response: Response;
  try {
    response = await fetch(base + path, {
      method,
      body: encoded,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ApiError(
      0,
      "Connection interrupted. This action may have reached the restaurant. Retry to safely confirm its result.",
    );
  }
  if (!response.ok && response.status < 500) pendingIntents.delete(intent);
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/auth/login" && path !== "/me")
      window.dispatchEvent(new Event("session-expired"));
    if (response.status === 403) csrf = null;
    throw new ApiError(
      response.status,
      problem.detail ||
        problem.message ||
        (response.status === 401
          ? "Your session has ended. Please sign in."
          : `Request could not be completed (${response.status}).`),
      problem.code,
    );
  }
  if (
    response.status === 204 ||
    response.headers.get("content-length") === "0"
  ) {
    pendingIntents.delete(intent);
    return undefined as T;
  }
  try {
    const text = await response.text();
    const result = text ? (JSON.parse(text) as T) : (undefined as T);
    // A successful status alone does not confirm that the response reached us.
    // Retain the key until the complete body has been received and decoded.
    pendingIntents.delete(intent);
    return result;
  } catch {
    throw new ApiError(
      0,
      "The restaurant response could not be confirmed. Retry to safely confirm the result.",
    );
  }
}
