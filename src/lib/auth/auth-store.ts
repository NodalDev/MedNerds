import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { authFailure, isRateLimit, validEmail, type AuthAction, type AuthResult } from './errors.ts';

export type AuthApi = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange' | 'signInWithOtp' | 'verifyOtp' | 'signOut'>;
export interface AuthSnapshot {
  readonly status: 'loading' | 'signed-out' | 'signed-in' | 'error';
  readonly email: string | null;
  readonly userId: string | null;
  readonly busy: AuthAction | null;
}
type Listener = (state: AuthSnapshot) => void;
export const CODE_REQUEST_INTERVAL_MS = 60_000;

/** Supabase owns sessions, persistence and refresh. This store exposes only UI state. */
export class AuthStore {
  private snapshot: AuthSnapshot = { status: 'loading', email: null, userId: null, busy: null };
  private listeners = new Set<Listener>();
  private subscription?: { unsubscribe(): void };
  private initialization?: Promise<void>;
  private revision = 0;
  private generation = 0;
  private nextRequestAt = 0;
  private readonly auth: AuthApi;
  private readonly now: () => number;

  constructor(auth: AuthApi, now: () => number = Date.now) {
    this.auth = auth;
    this.now = now;
  }

  get state(): AuthSnapshot { return this.snapshot; }
  get resendSeconds(): number { return Math.max(0, Math.ceil((this.nextRequestAt - this.now()) / 1000)); }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    void this.initialize();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.generation++;
        this.subscription?.unsubscribe();
        this.subscription = undefined;
        this.initialization = undefined;
      }
    };
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    const generation = this.generation;
    this.update({ status: 'loading', email: null, userId: null });
    // Keep this callback synchronous; do not call auth methods from it.
    this.subscription = this.auth.onAuthStateChange((_event, session) => {
      if (generation !== this.generation) return;
      this.revision++;
      this.receiveSession(session);
    }).data.subscription;
    const revision = this.revision;
    this.initialization = this.auth.getSession().then(({ data, error }) => {
      if (generation !== this.generation || revision !== this.revision) return;
      if (error) this.update({ status: 'error', email: null, userId: null });
      else this.receiveSession(data.session);
    }).catch(() => {
      if (generation === this.generation && revision === this.revision) this.update({ status: 'error', email: null, userId: null });
    });
    return this.initialization;
  }

  private update(patch: Partial<AuthSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private receiveSession(session: Session | null): void {
    this.update({ status: session ? 'signed-in' : 'signed-out', email: session?.user.email ?? null, userId: session?.user.id ?? null });
  }

  private async perform(action: AuthAction, operation: () => Promise<AuthResult>): Promise<AuthResult> {
    if (this.snapshot.busy) return { ok: false, message: 'Bitte warte, bis der laufende Vorgang abgeschlossen ist.' };
    this.update({ busy: action });
    try { return await operation(); }
    catch (error) { return authFailure(error, action); }
    finally { this.update({ busy: null }); }
  }

  async requestCode(rawEmail: string, captchaToken: string | undefined): Promise<AuthResult> {
    const email = rawEmail.trim();
    if (!validEmail(email)) return { ok: false, field: 'email', message: 'Bitte gib eine gültige E-Mail-Adresse ein.' };
    if (!captchaToken?.trim()) return { ok: false, field: 'captcha', message: 'Bitte bestätige zuerst die Sicherheitsprüfung.' };
    if (this.resendSeconds > 0) return { ok: false, message: `Bitte warte noch ${this.resendSeconds} Sekunden, bevor du einen neuen Code anforderst.` };
    return this.perform('send', async () => {
      const { error } = await this.auth.signInWithOtp({ email, options: { shouldCreateUser: true, captchaToken } });
      // This is a UX cooldown; Supabase remains authoritative for rate limits.
      if (!error || isRateLimit(error)) this.nextRequestAt = this.now() + CODE_REQUEST_INTERVAL_MS;
      return error ? authFailure(error, 'send') : { ok: true };
    });
  }

  async verifyCode(rawEmail: string, rawCode: string): Promise<AuthResult> {
    const email = rawEmail.trim();
    const token = rawCode.trim();
    if (!validEmail(email)) return { ok: false, field: 'email', message: 'Bitte fordere zuerst einen Code für deine E-Mail-Adresse an.' };
    if (!/^\d{6}$/.test(token)) return { ok: false, field: 'otp', message: 'Bitte gib den sechsstelligen Anmeldecode ein.' };
    return this.perform('verify', async () => {
      const { data, error } = await this.auth.verifyOtp({ email, token, type: 'email' });
      if (error) return authFailure(error, 'verify');
      if (!data.session) return authFailure(undefined, 'verify');
      this.revision++;
      this.receiveSession(data.session);
      return { ok: true };
    });
  }

  async signOut(): Promise<AuthResult> {
    return this.perform('logout', async () => {
      const { error } = await this.auth.signOut();
      if (error) {
        // Current SDK versions may emit SIGNED_OUT even when remote revocation failed.
        if (this.snapshot.status === 'signed-out') return {
          ok: false,
          message: 'Deine Sitzung auf diesem Gerät ist beendet. Die vollständige Abmeldung konnte nicht bestätigt werden. Bitte prüfe deine Verbindung.',
        };
        return authFailure(error, 'logout');
      }
      this.revision++;
      this.receiveSession(null);
      return { ok: true };
    });
  }
}
