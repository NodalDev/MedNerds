export type AuthAction = 'send' | 'verify' | 'logout';
export type AuthField = 'email' | 'otp' | 'captcha';
export type AuthResult = { ok: true } | { ok: false; message: string; field?: AuthField };

export function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isRateLimit(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: number; code?: string };
  return value.status === 429 || ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(value.code ?? '');
}

/** Never expose server messages, user data or network diagnostics in the UI. */
export function authFailure(error: unknown, action: AuthAction): AuthResult {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (isRateLimit(error)) return { ok: false, message: 'Zu viele Versuche. Bitte warte mindestens eine Minute und versuche es erneut.' };
  if (code === 'email_address_invalid') return { ok: false, field: 'email', message: 'Bitte gib eine gültige E-Mail-Adresse ein.' };
  if (code === 'captcha_failed') return { ok: false, field: 'captcha', message: 'Die Sicherheitsprüfung ist nicht mehr gültig. Bitte bestätige sie erneut.' };
  if (action === 'verify' && ['otp_expired', 'invalid_credentials', 'validation_failed'].includes(String(code))) {
    return { ok: false, field: 'otp', message: 'Der Anmeldecode ist ungültig oder abgelaufen. Prüfe den Code oder fordere einen neuen an.' };
  }
  if (action === 'send') return { ok: false, message: 'Der Anmeldecode konnte nicht gesendet werden. Prüfe deine Verbindung und versuche es später erneut.' };
  if (action === 'logout') return { ok: false, message: 'Die Abmeldung ist fehlgeschlagen. Bitte prüfe deine Verbindung und versuche es erneut.' };
  return { ok: false, field: 'otp', message: 'Die Anmeldung konnte nicht abgeschlossen werden. Bitte prüfe deine Verbindung und versuche es erneut.' };
}
