/**
 * Server-side validation of admin account input (OD-114: name, email, phone, optional Telegram ID).
 * Every account route runs input through here; client checks are UX only.
 */

export interface AdminAccountInput {
  name: string;
  email: string;
  phone: string;
  telegramId: string | null;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;
// A numeric Telegram user id, or an @username (5-32 of letters, digits, underscore).
const TELEGRAM_RE = /^(?:[0-9]{5,15}|@[A-Za-z0-9_]{5,32})$/;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'Email is required' };
  const email = normalizeEmail(raw);
  if (email.length === 0 || email.length > 254 || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Email is not valid' };
  }
  return { ok: true, value: email };
}

export function validatePassword(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string' || raw.length < PASSWORD_MIN || raw.length > PASSWORD_MAX) {
    return { ok: false, error: `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters` };
  }
  return { ok: true, value: raw };
}

export function validateAccountInput(body: unknown): ValidationResult<AdminAccountInput> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Request body must be an object' };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (name.length === 0 || name.length > 100) return { ok: false, error: 'Name must be 1 to 100 characters' };

  const email = validateEmail(b.email);
  if (!email.ok) return email;

  const phone = typeof b.phone === 'string' ? b.phone.replace(/[\s-]/g, '') : '';
  if (!PHONE_RE.test(phone)) return { ok: false, error: 'Phone must be 10 to 15 digits, optionally starting with +' };

  let telegramId: string | null = null;
  if (b.telegramId !== undefined && b.telegramId !== null && b.telegramId !== '') {
    if (typeof b.telegramId !== 'string' || !TELEGRAM_RE.test(b.telegramId.trim())) {
      return { ok: false, error: 'Telegram ID must be a numeric id or an @username' };
    }
    telegramId = b.telegramId.trim();
  }

  return { ok: true, value: { name, email: email.value, phone, telegramId } };
}
