import { getAuthConfiguration, getBrowserAuthStore, getSupabaseBrowserClient } from './supabase-client.ts';
import type { AuthStore, AuthSnapshot } from './auth-store.ts';
import { validEmail, type AuthField, type AuthResult } from './errors.ts';
import { TurnstileChallenge } from './turnstile.ts';
import { ProfileStore, createProfileApi, type ProfileSnapshot } from './profile-store.ts';
import type { Profile } from './profile.ts';

class AccountElement extends HTMLElement {
  private auth?: AuthStore;
  private snapshot?: AuthSnapshot;
  private events?: AbortController;
  private unsubscribe?: () => void;
  private challenge?: TurnstileChallenge;
  private challengeStep?: 'email' | 'code';
  private challengeSize?: 'compact' | 'flexible';
  private challengeTheme?: 'dark' | 'light';
  private siteKey = '';
  private captchaReady = false;
  private step: 'email' | 'code' = 'email';
  private resendOpen = false;
  private pendingEmail = '';
  private errorMessage = '';
  private errorField?: AuthField;
  private statusMessage = '';
  private timer?: number;
  private statusTimer?: number;
  private themeObserver?: MutationObserver;
  private resizeObserver?: ResizeObserver;
  private generation = 0;
  private profiles?: ProfileStore;
  private profileUnsubscribe?: () => void;
  private displayedProfile?: Profile | null;

  connectedCallback(): void {
    this.cleanup();
    this.auth = undefined;
    this.snapshot = undefined;
    this.step = 'email';
    this.resendOpen = false;
    this.pendingEmail = '';
    this.statusMessage = this.errorMessage = '';
    this.errorField = undefined;
    this.events = new AbortController();
    this.displayedProfile = undefined;
    const { signal } = this.events;
    this.control<HTMLFormElement>('[data-email-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendCode(false);
    }, { signal });
    this.control<HTMLFormElement>('[data-code-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.verifyCode();
    }, { signal });
    this.control('[data-resend]').addEventListener('click', () => { void this.sendCode(true); }, { signal });
    this.control('[data-open-resend]').addEventListener('click', () => this.openResend(), { signal });
    this.control('[data-cancel-resend]').addEventListener('click', () => this.closeResend(), { signal });
    this.control('[data-change-email]').addEventListener('click', () => this.changeEmail(), { signal });
    this.control('[data-retry-captcha]').addEventListener('click', () => this.mountChallenge(), { signal });
    this.control('[data-logout]').addEventListener('click', () => { void this.signOut(); }, { signal });
    this.control('[data-reload]').addEventListener('click', () => window.location.reload(), { signal });
    this.control<HTMLFormElement>('[data-profile-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.snapshot?.status !== 'signed-in' || this.snapshot.busy) return;
      void this.profiles?.save(this.control<HTMLInputElement>('#account-display-name').value);
    }, { signal });
    this.control('[data-profile-retry]').addEventListener('click', () => { void this.profiles?.load(); }, { signal });
    this.control<HTMLInputElement>('#account-email').addEventListener('input', () => {
      if (this.errorField === 'email') this.clearError();
    }, { signal });
    this.control<HTMLInputElement>('#account-otp').addEventListener('input', () => {
      if (this.errorField === 'otp') this.clearError();
    }, { signal });
    document.addEventListener('astro:before-swap', () => this.cleanup(), { signal, once: true });

    const configuration = getAuthConfiguration();
    if (!configuration.ok) {
      this.showUnavailable(configuration.message);
      return;
    }
    try { this.auth = getBrowserAuthStore(); }
    catch { this.showUnavailable('Die Anmeldung konnte nicht vorbereitet werden. Bitte versuche es später erneut.'); return; }
    if (!this.auth) { this.showUnavailable('Die Anmeldung ist derzeit nicht verfügbar.'); return; }
    const client = getSupabaseBrowserClient();
    if (client) {
      this.profiles = new ProfileStore(createProfileApi(client));
      this.profileUnsubscribe = this.profiles.subscribe((state) => this.renderProfile(state));
    }
    this.siteKey = configuration.config.turnstileSiteKey;
    this.unsubscribe = this.auth.subscribe((state) => {
      const previous = this.snapshot?.status;
      this.snapshot = state;
      this.profiles?.setUser(state.status === 'signed-in' ? state.userId : null);
      if (this.profiles) this.renderProfile(this.profiles.state);
      if (state.status === 'signed-in') {
        this.resendOpen = false;
        this.errorMessage = '';
        this.errorField = undefined;
        this.control<HTMLInputElement>('#account-otp').value = '';
      } else if (previous === 'signed-in' && state.status === 'signed-out') {
        this.step = 'email';
        this.resendOpen = false;
        this.pendingEmail = '';
        if (state.busy !== 'logout') this.statusMessage = 'Deine Sitzung ist beendet. Bitte melde dich erneut an.';
      }
      this.render();
    });
    this.themeObserver = new MutationObserver(() => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      if (this.challengeStep && theme !== this.challengeTheme) this.mountChallenge();
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.resizeObserver = new ResizeObserver(() => {
      if (!this.challengeStep) return;
      const host = this.challengeHost();
      const size = host.clientWidth < 300 ? 'compact' : 'flexible';
      if (size !== this.challengeSize) this.mountChallenge();
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback(): void { this.cleanup(); }

  private renderProfile(state: ProfileSnapshot): void {
    const input = this.control<HTMLInputElement>('#account-display-name');
    if (this.displayedProfile !== state.profile) {
      input.value = state.profile?.display_name ?? '';
      this.displayedProfile = state.profile;
    }
    const busy = state.saving || Boolean(this.snapshot?.busy);
    input.disabled = busy || state.status !== 'ready';
    input.setAttribute('aria-invalid', String(state.invalidName));
    input.setAttribute('aria-describedby', state.invalidName ? 'account-name-hint account-profile-error' : 'account-name-hint');
    this.control('[data-profile-loading]').hidden = state.status !== 'loading';
    this.control('[data-profile-form]').hidden = state.status !== 'ready';
    this.control('[data-profile-form]').setAttribute('aria-busy', String(state.saving));
    this.control<HTMLButtonElement>('[data-profile-save]').disabled = busy;
    this.control('[data-profile-save]').textContent = state.saving ? 'Wird gespeichert …' : 'Änderungen speichern';
    this.control('[data-profile-status]').textContent = state.message;
    this.control('[data-profile-error]').textContent = state.error;
    this.control('[data-profile-error]').hidden = !state.error;
    this.control('[data-profile-retry]').hidden = state.status !== 'error';
    this.control<HTMLButtonElement>('[data-profile-retry]').disabled = busy;
    const role = this.control('[data-staff-role]');
    role.hidden = state.status !== 'ready' || state.staffStatus === 'loading';
    role.textContent = state.staffStatus === 'error' ? 'Die Staff-Zuordnung konnte nicht geladen werden.'
      : state.staff?.role === 'admin' ? 'Rolle: Administrator'
      : state.staff?.role === 'author' ? 'Rolle: MedNerds-Autor' : 'Rolle: Nutzer';
  }

  private control<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.querySelector<T>(selector);
    if (!element) throw new Error('Incomplete account markup');
    return element;
  }

  private showUnavailable(message: string): void {
    this.control('[data-loading]').hidden = true;
    this.control('[data-login]').hidden = true;
    this.control('[data-session]').hidden = true;
    this.control('[data-reload]').hidden = false;
    this.setError(message);
  }

  private render(): void {
    const state = this.snapshot;
    if (!state) return;
    this.control('[data-loading]').hidden = state.status !== 'loading';
    this.control('[data-login]').hidden = state.status !== 'signed-out';
    this.control('[data-session]').hidden = state.status !== 'signed-in';
    this.control('[data-reload]').hidden = state.status !== 'error';
    this.control('[data-email-form]').hidden = this.step !== 'email';
    this.control('[data-code-step]').hidden = this.step !== 'code';
    this.control('[data-resend-panel]').hidden = !this.resendOpen;
    this.control('[data-open-resend]').setAttribute('aria-expanded', String(this.resendOpen));
    this.control('[data-delivery-email]').textContent = this.pendingEmail;
    this.control('[data-session-email]').textContent = state.email ?? '';
    this.control('[data-status]').textContent = this.statusMessage;
    if (state.status === 'error') this.errorMessage = 'Dein Anmeldestatus konnte nicht geladen werden. Bitte lade die Seite neu.';
    const error = this.control('[data-error]');
    error.textContent = this.errorMessage;
    error.hidden = !this.errorMessage;
    for (const [field, selector] of [['email', '#account-email'], ['otp', '#account-otp']] as const) {
      const input = this.control<HTMLInputElement>(selector);
      const invalid = this.errorField === field && Boolean(this.errorMessage);
      input.setAttribute('aria-invalid', String(invalid));
      const describedBy = [field === 'otp' ? 'account-code-hint' : '', invalid ? 'account-error' : ''].filter(Boolean).join(' ');
      if (describedBy) input.setAttribute('aria-describedby', describedBy);
      else input.removeAttribute('aria-describedby');
      input.disabled = Boolean(state.busy);
    }
    for (const selector of ['[data-email-challenge]', '[data-resend-challenge]']) {
      const host = this.control(selector);
      if (this.errorField === 'captcha') host.setAttribute('aria-describedby', 'account-error');
      else host.removeAttribute('aria-describedby');
    }
    const busy = Boolean(state.busy);
    this.control<HTMLButtonElement>('[data-verify]').disabled = busy;
    this.control('[data-verify]').textContent = state.busy === 'verify' ? 'Code wird geprüft …' : 'Code bestätigen';
    this.control('[data-verify]').classList.toggle('account-text-button', this.resendOpen);
    this.control<HTMLButtonElement>('[data-logout]').disabled = busy;
    this.control('[data-logout]').textContent = state.busy === 'logout' ? 'Abmeldung läuft …' : 'Abmelden';
    this.control<HTMLButtonElement>('[data-change-email]').disabled = busy;
    this.control<HTMLButtonElement>('[data-open-resend]').disabled = busy;
    this.control<HTMLButtonElement>('[data-cancel-resend]').disabled = busy;
    this.control<HTMLButtonElement>('[data-retry-captcha]').disabled = busy;
    this.control('[data-retry-captcha]').hidden = this.errorField !== 'captcha' || !this.desiredChallengeStep();
    for (const form of this.querySelectorAll('[data-email-form], [data-code-form]')) form.setAttribute('aria-busy', String(busy));
    this.renderCooldown();
    const desiredStep = this.desiredChallengeStep();
    if (desiredStep && this.challengeStep !== desiredStep) this.mountChallenge();
    else if (!desiredStep) this.disposeChallenge();
  }

  private renderCooldown(): void {
    const seconds = this.auth?.resendSeconds ?? 0;
    const busy = Boolean(this.snapshot?.busy);
    const disabled = busy || !this.captchaReady || seconds > 0;
    this.control<HTMLButtonElement>('[data-send]').disabled = disabled;
    this.control<HTMLButtonElement>('[data-resend]').disabled = disabled;
    this.control('[data-send]').textContent = this.snapshot?.busy === 'send' ? 'Code wird gesendet …' : 'Anmeldecode senden';
    this.control('[data-resend]').textContent = this.snapshot?.busy === 'send' ? 'Code wird gesendet …' : 'Code erneut senden';
    const hint = this.control('[data-cooldown]');
    hint.hidden = seconds === 0;
    hint.textContent = seconds ? `Neuer Code in ${seconds} s` : '';
    const emailHint = this.control('[data-email-cooldown]');
    emailHint.hidden = seconds === 0;
    emailHint.textContent = hint.textContent;
    this.control('[data-open-resend]').hidden = seconds > 0 || this.resendOpen;
    // The AuthStore deadline is authoritative; render never restarts the countdown.
    const needsTimer = seconds > 0 && this.snapshot?.status === 'signed-out';
    if (needsTimer && this.timer === undefined) this.timer = window.setInterval(() => this.renderCooldown(), 1000);
    else if (!needsTimer && this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private desiredChallengeStep(): 'email' | 'code' | undefined {
    if (this.snapshot?.status !== 'signed-out') return undefined;
    return this.step === 'email' ? 'email' : this.resendOpen ? 'code' : undefined;
  }

  private disposeChallenge(): void {
    this.challenge?.dispose();
    this.challenge = undefined;
    this.challengeStep = undefined;
    this.captchaReady = false;
  }

  private openResend(): void {
    if (this.snapshot?.busy || this.step !== 'code' || !this.auth || this.auth.resendSeconds > 0) return;
    this.resendOpen = true;
    this.statusMessage = '';
    this.clearError();
    this.control('#account-resend-title').focus();
  }

  private closeResend(): void {
    if (this.snapshot?.busy) return;
    this.resendOpen = false;
    this.clearError();
    const trigger = this.control('[data-open-resend]');
    if (trigger.hidden) this.control('#account-otp').focus();
    else trigger.focus();
  }

  private challengeHost(): HTMLElement {
    return this.control(this.step === 'email' ? '[data-email-challenge]' : '[data-resend-challenge]');
  }

  private mountChallenge(): void {
    if (!this.desiredChallengeStep()) return;
    this.challenge?.dispose();
    this.captchaReady = false;
    this.challengeStep = this.step;
    const host = this.challengeHost();
    this.challengeSize = host.clientWidth < 300 ? 'compact' : 'flexible';
    this.challengeTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    const generation = this.generation;
    this.challenge = new TurnstileChallenge(host, this.siteKey, (ready, message) => {
      if (generation !== this.generation) return;
      this.captchaReady = ready;
      if (message) this.setError(message, 'captcha');
      else if (ready && this.errorField === 'captcha') this.clearError();
      this.renderCooldown();
    });
    void this.challenge.mount();
  }

  private setError(message: string, field?: AuthField): void {
    this.errorMessage = message;
    this.errorField = field;
    this.render();
    if (!this.snapshot) {
      const error = this.control('[data-error]');
      error.textContent = message;
      error.hidden = false;
    }
  }

  private clearError(): void {
    this.errorMessage = '';
    this.errorField = undefined;
    this.render();
  }

  private handleResult(result: AuthResult): boolean {
    if (result.ok) { this.clearError(); return true; }
    this.setError(result.message, result.field);
    return false;
  }

  private async sendCode(resend: boolean): Promise<void> {
    if (!this.auth || this.snapshot?.busy || this.snapshot?.status !== 'signed-out') return;
    if (resend && !this.resendOpen) return;
    const email = (resend ? this.pendingEmail : this.control<HTMLInputElement>('#account-email').value).trim();
    if (!validEmail(email)) {
      this.setError('Bitte gib eine gültige E-Mail-Adresse ein.', 'email');
      this.control<HTMLInputElement>('#account-email').focus();
      return;
    }
    const generation = this.generation;
    const token = this.challenge?.takeToken();
    if (!token) { this.setError('Bitte bestätige zuerst die Sicherheitsprüfung.', 'captcha'); return; }
    this.statusMessage = '';
    const result = await this.auth.requestCode(email, token);
    if (generation !== this.generation) return;
    if (!this.handleResult(result)) { this.challenge?.reset(); return; }
    this.pendingEmail = email;
    this.step = 'code';
    this.resendOpen = false;
    if (!resend) this.control<HTMLInputElement>('#account-otp').value = '';
    this.statusMessage = resend ? 'Neuer Code gesendet.' : '';
    this.render();
    this.control<HTMLInputElement>('#account-otp').focus();
    window.clearTimeout(this.statusTimer);
    if (resend) this.statusTimer = window.setTimeout(() => {
      if (generation !== this.generation || this.statusMessage !== 'Neuer Code gesendet.') return;
      this.statusMessage = '';
      this.render();
    }, 2000);
  }

  private async verifyCode(): Promise<void> {
    if (!this.auth || this.snapshot?.busy || this.step !== 'code') return;
    const generation = this.generation;
    const code = this.control<HTMLInputElement>('#account-otp').value;
    this.statusMessage = '';
    const result = await this.auth.verifyCode(this.pendingEmail, code);
    if (generation !== this.generation) return;
    if (this.handleResult(result)) {
      this.statusMessage = 'Du bist jetzt angemeldet.';
      this.render();
    }
  }

  private changeEmail(): void {
    if (this.snapshot?.busy) return;
    this.step = 'email';
    this.resendOpen = false;
    this.pendingEmail = '';
    this.control<HTMLInputElement>('#account-otp').value = '';
    this.statusMessage = '';
    this.clearError();
    this.control<HTMLInputElement>('#account-email').focus();
  }

  private async signOut(): Promise<void> {
    if (!this.auth || this.snapshot?.busy) return;
    const generation = this.generation;
    const result = await this.auth.signOut();
    if (generation !== this.generation) return;
    if (this.handleResult(result)) {
      this.statusMessage = 'Du bist abgemeldet.';
      this.render();
      this.control<HTMLInputElement>('#account-email').focus();
    }
  }

  private cleanup(): void {
    this.generation++;
    this.events?.abort();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.profileUnsubscribe?.();
    this.profileUnsubscribe = undefined;
    this.profiles?.dispose();
    this.profiles = undefined;
    this.control<HTMLInputElement>('#account-display-name').value = '';
    this.themeObserver?.disconnect();
    this.resizeObserver?.disconnect();
    window.clearInterval(this.timer);
    window.clearTimeout(this.statusTimer);
    this.timer = undefined;
    this.disposeChallenge();
  }
}

export function registerAccountElement(): void {
  if (!customElements.get('mednerds-account')) customElements.define('mednerds-account', AccountElement);
}
