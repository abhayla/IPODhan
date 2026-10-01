/**
 * One reading of a refused admin save, for every save the IPO page editor makes (#1348).
 *
 * The admin routes answer a refusal in three body shapes: `{ error, reason }` (adminWriteResponse and
 * the list route), `{ error, message }` (the auth gate's 401/403 and the visibility route), and
 * `{ error: { code, message } }` (apiErrorResponse on a 500). A proxy can also answer with no JSON at
 * all, and a dropped connection throws before any answer. Each caller used to read one shape, so a
 * 500 printed "[object Object]" and a network failure printed nothing.
 */

export const NETWORK_FAILURE_REASON = 'the request did not reach the server. Check the connection and try again.';

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** The API's own reason for a non-2xx answer, or a plain statement of the status when it gave none. */
export function adminFailureReason(status: number, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const nested = b.error && typeof b.error === 'object' ? (b.error as Record<string, unknown>) : null;
  const given = text(b.reason) ?? text(b.message) ?? text(nested?.message) ?? text(b.error);
  if (given) return given;
  if (status === 401) return 'your admin session has ended. Sign in again.';
  if (status === 403) return 'this admin account is not allowed to make this change.';
  return `the server refused it (HTTP ${status}).`;
}

/** Read a response body as JSON, or `{}` when it is not JSON (a proxy error page, an empty body). */
export async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const parsed = await res.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The line the admin sees next to the field. "Not saved" first, so it can never read as a success. */
export function notSavedText(reason: string): string {
  return `Not saved: ${reason}`;
}
