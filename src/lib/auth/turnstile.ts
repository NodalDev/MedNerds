interface TurnstileOptions {
  sitekey: string;
  theme: 'dark' | 'light';
  size: 'compact' | 'flexible';
  language: 'de';
  'response-field': false;
  'refresh-expired': 'never';
  'refresh-timeout': 'never';
  callback(token: string): void;
  'expired-callback'(): void;
  'timeout-callback'(): void;
  'error-callback'(): boolean;
  'unsupported-callback'(): void;
}

export interface TurnstileApi {
  render(host: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
  isExpired(id: string): boolean;
}

declare global { interface Window { turnstile?: TurnstileApi } }

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | undefined;

/** Loaded on demand by the account component, once per browser document. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.dataset.mednerdsTurnstile = '';
    const finish = (failed: boolean) => {
      window.clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (failed || !window.turnstile) {
        script.remove();
        reject(new Error('Turnstile unavailable'));
      } else resolve(window.turnstile);
    };
    const timeout = window.setTimeout(() => finish(true), 20_000);
    script.onload = () => finish(false);
    script.onerror = () => finish(true);
    document.head.append(script);
  }).catch((error: unknown) => {
    scriptPromise = undefined;
    throw error;
  });
  return scriptPromise;
}

/** One mounted widget; only its successful callback can supply a token. */
export class TurnstileChallenge {
  private api?: TurnstileApi;
  private id?: string;
  private token?: string;
  private generation = 0;
  private readonly host: HTMLElement;
  private readonly siteKey: string;
  private readonly onChange: (ready: boolean, message?: string) => void;
  private readonly loader: () => Promise<TurnstileApi>;

  constructor(host: HTMLElement, siteKey: string, onChange: (ready: boolean, message?: string) => void,
    loader: () => Promise<TurnstileApi> = loadTurnstile) {
    this.host = host;
    this.siteKey = siteKey;
    this.onChange = onChange;
    this.loader = loader;
  }

  async mount(): Promise<void> {
    this.dispose();
    const generation = this.generation;
    this.onChange(false);
    try {
      const api = await this.loader();
      if (generation !== this.generation) return;
      this.api = api;
      const invalidate = (message: string, reset = false) => {
        if (generation !== this.generation) return;
        this.token = undefined;
        this.onChange(false, message);
        if (reset && this.id) this.reset();
      };
      this.id = api.render(this.host, {
        sitekey: this.siteKey,
        theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
        size: this.host.clientWidth < 300 ? 'compact' : 'flexible',
        language: 'de',
        'response-field': false,
        'refresh-expired': 'never',
        'refresh-timeout': 'never',
        callback: (token) => {
          if (generation !== this.generation) return;
          this.token = token || undefined;
          this.onChange(Boolean(this.token));
        },
        'expired-callback': () => invalidate('Die Sicherheitsprüfung ist abgelaufen. Bitte bestätige sie erneut.', true),
        'timeout-callback': () => invalidate('Die Sicherheitsprüfung wurde nicht rechtzeitig abgeschlossen. Bitte versuche es erneut.', true),
        'error-callback': () => {
          invalidate('Die Sicherheitsprüfung ist fehlgeschlagen. Bitte lade sie erneut.');
          return true;
        },
        'unsupported-callback': () => invalidate('Dein Browser unterstützt die Sicherheitsprüfung nicht. Bitte verwende einen aktuellen Browser.'),
      });
      if (!this.id) throw new Error('Widget unavailable');
    } catch {
      if (generation === this.generation) this.onChange(false, 'Die Sicherheitsprüfung konnte nicht geladen werden. Prüfe deine Verbindung und lade sie erneut.');
    }
  }

  takeToken(): string | undefined {
    let expired = true;
    try { expired = !this.id || !this.api || this.api.isExpired(this.id); }
    catch { /* Treat an unavailable widget as unverified. */ }
    if (expired) {
      this.token = undefined;
      this.onChange(false, 'Bitte bestätige die Sicherheitsprüfung erneut.');
      return undefined;
    }
    const token = this.token;
    this.token = undefined;
    this.onChange(false);
    return token;
  }

  reset(): void {
    this.token = undefined;
    this.onChange(false);
    try { if (this.id) this.api?.reset(this.id); }
    catch { this.onChange(false, 'Bitte lade die Sicherheitsprüfung erneut.'); }
  }

  dispose(): void {
    this.generation++;
    this.token = undefined;
    try { if (this.id) this.api?.remove(this.id); }
    catch { /* Navigation must remain possible even if the external script failed. */ }
    this.id = undefined;
    this.api = undefined;
  }
}
