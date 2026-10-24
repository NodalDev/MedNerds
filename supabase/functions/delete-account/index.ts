import { createClient } from '@supabase/supabase-js';
import { createDeletionHandler, verifiedSessionId, type DeletionDependencies } from './handler.ts';

// Module-local Deno boundary; the handler itself uses portable Web APIs for mocks.
declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (request: Request) => Promise<Response>): void };
const url = Deno.env.get('SUPABASE_URL') ?? '';
const publicKey = Deno.env.get('ACCOUNT_DELETION_PUBLIC_KEY') ?? '';
const secretKey = Deno.env.get('ACCOUNT_DELETION_SECRET_KEY') ?? '';
const origins = (Deno.env.get('ACCOUNT_DELETION_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const enabled = Deno.env.get('ACCOUNT_DELETION_ENABLED') === 'true' && Boolean(url && publicKey && secretKey && origins.length);
const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

Deno.serve(createDeletionHandler({ enabled, origins, dependencies(): DeletionDependencies {
  // Server-only admin and isolated OTP client. No shared/browser OTP session mutation.
  const admin = createClient(url, secretKey, { auth: authOptions });
  const otp = createClient(url, publicKey, { auth: authOptions });
  return {
    async authenticate(token) {
      const { data, error } = await admin.auth.getUser(token);
      const sessionId = error ? null : verifiedSessionId(token);
      const user = data.user;
      if (error || !user?.email || !user.email_confirmed_at || !sessionId || user.is_anonymous) return null;
      return { id: user.id, email: user.email, sessionId };
    },
    async begin(user) {
      const { data, error } = await admin.rpc('account_deletion_begin', { target_user: user.id, target_session: user.sessionId });
      const value: unknown = data;
      if (error || !value || typeof value !== 'object' || !('status' in value) || typeof value.status !== 'string') throw new Error('Unavailable');
      return { status: value.status, challengeId: 'challenge_id' in value && typeof value.challenge_id === 'string' ? value.challenge_id : undefined };
    },
    async sendOtp(email, captchaToken) {
      const { error } = await otp.auth.signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } });
      return !error;
    },
    async ready(user, challenge) {
      const { data, error } = await admin.rpc('account_deletion_ready', { target_user: user.id, target_session: user.sessionId, challenge });
      return !error && data === true;
    },
    async claim(user, challenge) {
      const { data, error } = await admin.rpc('account_deletion_claim', { target_user: user.id, target_session: user.sessionId, challenge });
      return !error && data === true;
    },
    async verifyOtp(email, token) {
      const { data, error } = await otp.auth.verifyOtp({ email, token, type: 'email' });
      return !error && data.session && data.user?.email_confirmed_at ? data.user.id : null;
    },
    async authorize(user, challenge) {
      const { data, error } = await admin.rpc('account_deletion_authorize', { target_user: user.id, target_session: user.sessionId, challenge });
      return !error && data === true;
    },
    async deleteUser(id) {
      const { error } = await admin.auth.admin.deleteUser(id, false);
      return !error;
    },
    async cleanup() { await otp.auth.signOut({ scope: 'local' }); },
  };
} }));
