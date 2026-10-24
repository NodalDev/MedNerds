export interface VerifiedAccount { id: string; email: string; sessionId: string }
export interface DeletionDependencies {
  authenticate(token: string): Promise<VerifiedAccount | null>;
  begin(user: VerifiedAccount): Promise<{ status: string; challengeId?: string }>;
  sendOtp(email: string, captcha: string): Promise<boolean>;
  ready(user: VerifiedAccount, challenge: string): Promise<boolean>;
  claim(user: VerifiedAccount, challenge: string): Promise<boolean>;
  verifyOtp(email: string, code: string): Promise<string | null>;
  authorize(user: VerifiedAccount, challenge: string): Promise<boolean>;
  deleteUser(userId: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decode ONLY after Auth has verified this token. Identity comes from getUser. */
export function verifiedSessionId(token: string): string | null {
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(atob(encoded));
    if (claims && typeof claims === 'object' && 'session_id' in claims
      && typeof claims.session_id === 'string' && uuidPattern.test(claims.session_id)) return claims.session_id;
  } catch { /* A malformed/missing session claim is not usable. */ }
  return null;
}

/** No user IDs accepted in HTTP bodies; no provider diagnostics or tokens returned. */
export function createDeletionHandler(options: {
  enabled: boolean; origins: readonly string[]; dependencies(): DeletionDependencies;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const origin = request.headers.get('origin');
    const allowed = origin !== null && options.origins.includes(origin);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' } : {}),
    };
    const reply = (status: number, code: string, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ status: code, ...extra }), { status, headers });
    if (origin !== null && !allowed) return reply(403, 'not_allowed');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, 'not_allowed');
    if (!options.enabled) return reply(503, 'unavailable');
    const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/);
    if (!match) return reply(401, 'not_authenticated');
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(400, 'invalid_request');
    let deps: DeletionDependencies | undefined;
    try {
      deps = options.dependencies();
      const user = await deps.authenticate(match[1]);
      if (!user) return reply(401, 'not_authenticated');
      const text = await request.text();
      if (text.length > 4096) return reply(400, 'invalid_request');
      const body: unknown = JSON.parse(text);
      if (!body || typeof body !== 'object' || Array.isArray(body) || !('action' in body)) return reply(400, 'invalid_request');
      if (body.action === 'begin') {
        if (Object.keys(body).some(key => !['action', 'captchaToken'].includes(key))
          || !('captchaToken' in body) || typeof body.captchaToken !== 'string'
          || !body.captchaToken.trim() || body.captchaToken.length > 2048) return reply(400, 'invalid_request');
        const intent = await deps.begin(user);
        if (intent.status !== 'created' || !intent.challengeId || !uuidPattern.test(intent.challengeId)) {
          return reply(intent.status === 'last_admin' ? 409 : intent.status === 'rate_limited' ? 429 : 403,
            ['last_admin', 'rate_limited', 'not_authenticated'].includes(intent.status) ? intent.status : 'unavailable');
        }
        if (!await deps.sendOtp(user.email, body.captchaToken)) return reply(400, 'code_not_sent');
        if (!await deps.ready(user, intent.challengeId)) return reply(409, 'confirmation_invalid');
        return reply(200, 'code_sent', { challengeId: intent.challengeId, expiresIn: 300 });
      }
      if (body.action !== 'delete' || Object.keys(body).some(key => !['action', 'challengeId', 'code', 'confirmed'].includes(key))
        || !('confirmed' in body) || body.confirmed !== true
        || !('challengeId' in body) || typeof body.challengeId !== 'string' || !uuidPattern.test(body.challengeId)
        || !('code' in body) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return reply(400, 'invalid_request');
      if (!await deps.claim(user, body.challengeId)) return reply(409, 'confirmation_invalid');
      // Auth verifies the email's OTP; it does not bind that OTP to our challenge ID.
      if (await deps.verifyOtp(user.email, body.code) !== user.id) return reply(403, 'confirmation_invalid');
      const current = await deps.authenticate(match[1]);
      if (!current || current.id !== user.id || current.email !== user.email || current.sessionId !== user.sessionId) {
        return reply(401, 'not_authenticated');
      }
      if (!await deps.authorize(user, body.challengeId)) return reply(409, 'confirmation_invalid');
      // This RPC and Auth's DELETE are separate transactions: expiry/revocation can
      // still race after authorization. Only the last-admin guard runs in the DELETE.
      if (!await deps.deleteUser(user.id)) return reply(409, 'delete_failed');
      return reply(200, 'deleted');
    } catch { return reply(503, 'unavailable'); }
    finally { try { await deps?.cleanup(); } catch { /* Never leak authentication/cleanup details. */ } }
  };
}
