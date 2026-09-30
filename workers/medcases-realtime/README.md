# MedCases Realtime – Phases 6B–6F.4

This Worker remains **undeployed**. Run `npm run realtime:dev`, `npm run realtime:test`, and `npm run realtime:typecheck` locally. Wrangler stores local SQLite-backed Durable Object data under the Git-ignored `.wrangler/` directory. The deployable Wrangler configuration defaults to `ENVIRONMENT=production`; the local development script explicitly overrides it. No Worker hostname, route or custom domain is configured yet.

## Phase 6F.4 production configuration

`development` permits the existing local browser origins `http://localhost:4321` and `http://127.0.0.1:4321`, plus origin-less local test clients. Normal API routes and `/__dev/` test routes remain available, including the 1000–60000 ms test TTL. `production` enables the same rate-limited Session/Join/WebSocket API, but returns 404 for `/__dev/` routes and rejects the test-TTL header. Sessions retain the existing one-hour default TTL. Unknown environment values expose no session API.

Production rejects requests without a valid `Origin`. `ALLOWED_ORIGINS` is a comma-separated list of exact HTTPS origins, with whitespace and empty entries ignored; malformed and loopback entries are rejected. The deployable config currently contains only `https://mednerds.ch`, not `www.mednerds.ch` or any preview wildcard. CORS echoes only a validated origin. Origin validation supplements, but never replaces, capability authentication. The four rate-limit namespace IDs below remain unchanged and still need account-wide verification at deployment.

Production frontend builds require `PUBLIC_MEDCASES_REALTIME_URL=https://<actual-worker-origin>`; missing or invalid configuration disables the live UI and has no localhost fallback. HTTP and WS are allowed only for development, while production HTTPS maps only to WSS. `PUBLIC_MEDCASES_JOIN_BASE_URL` remains an optional **website** origin for invite links, separate from the Worker origin. Before the first deployment, the actual Worker hostname, Netlify environment setting and CSP Report-Only `connect-src` entry must be set from real deployment values. No remote configuration or deployment has been performed.

## Phase 6F.2 abuse limits

Native Cloudflare Rate Limiting bindings use separate account-unique namespace IDs: session creation `680201` (10/min), join lookup `680202` (120/min), WebSocket upgrades `680203` (120/min), and failed Examiner/Patient auth `680204` (30/min per client and session). Verify these IDs do not conflict with other Workers in the Cloudflare account before deployment. Limits are permissive, location-local abuse protection, **not** authentication or exact quotas. HTTP denials return `429` with a generic code and conservative `Retry-After: 60`; failed auth retains its generic error and the existing three-failures-per-socket closure. The client IP is hashed for a transient limiter key; raw IP is neither persisted nor logged. Hibernation attachments contain only this opaque key, never the raw IP or a capability.

Public control JSON requests are streamed with an 8 KiB hard limit, including absent or forged `Content-Length`; oversized bodies return `413`. Development-only debug requests retain their existing 1 KiB limit and `400` error. A session retains at most 64 distinct released material IDs; repeated releases remain idempotent. At most 3 Examiner, 3 Patient, 12 Display and 3 Observer sockets may authenticate concurrently per session, counted from hibernatable WebSocket attachments. No medical case data is added to the Worker. Run `node --experimental-strip-types scripts/test-medcases-realtime-abuse.mjs` for deterministic helper tests and `node scripts/test-medcases-realtime-abuse-live.mjs` against local Wrangler for endpoint and socket checks.

## Phase 6F.3 browser headers and patient cleanup

`public/_headers` configures site-wide Netlify security headers and a CSP in **Report-Only** mode. The current Astro/Starlight output needs inline scripts/styles and `data:` images; Infomaniak Newsletter requires its script, connection and form origins. No reporting service is configured. Validate reports in production before enforcing CSP, then add only the real production Worker origin to `connect-src`. Terminal Patient join/auth/expiry errors remove the tab-local credential; temporary network errors preserve it for retry. Run `node scripts/test-medcases-browser-security.mjs` after the Astro build.

## Local session flow

1. `POST /sessions` with JSON `{"caseId":"case-2bf98914ed","durationSeconds":780,"warningRemainingSeconds":120}` returns a random opaque `sessionId`, a six-character `joinCode`, independent `examinerCapability` and `patientCapability` values, and `expiresAtMs`.
2. `POST /sessions/join` with JSON `{"joinCode":"K7P4MX"}` resolves an active code to its `sessionId` and expiry. Lowercase input is accepted. The code never grants Examiner rights.
3. Connect to `GET /sessions/<sessionId>/connect` as a WebSocket. No snapshot arrives before the first valid authentication message. Observer and Display authenticate without a capability for read-only access. Patient authenticates with its separate patient capability for patient-specific material releases. Examiner authenticates with the examiner capability for timer controls and material releases.
4. `GET /__dev/sessions/<sessionId>/state` exposes only public state for local tests. The old `?role=examiner` query parameter is ignored for authorization.

The session ID uses 128 random bits. The join code uses six unbiased symbols from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; one SQLite-backed `JoinCodeEntry` Durable Object per code atomically reserves the mapping to a session ID. Collisions trigger up to eight new random attempts. Its expiry alarm and the session expiry use the same timestamp. Cleanup checks the expected session ID, so delayed cleanup cannot remove a later reservation.

Examiner and Patient capabilities are independently generated 256-bit **bearer secrets**. Their clear values appear only in the creation response. The session Durable Object persists only their SHA-256 hashes. WebSocket authentication hashes the supplied capability before granting the corresponding role; hibernation attachments retain only the role and connection metadata. Observer and Display can receive timer snapshots/events and use time sync but cannot change the timer or release materials. Session snapshots, join results, and the debug state response contain no capability or hash.

The default local retention is one hour; the local-only `X-MedNerds-Test-TTL-Ms` header accepts 1000–60000 ms for expiry tests. Development-only `/__dev/join-codes/<code>/reserve|lookup|release` routes let the live test exercise atomic reservation, expiry, reuse, and ownership-safe release directly. The Worker still stores no medical case content, personal information, checklists, or notes. The authoritative timer sends state changes and alarms, not a per-second countdown.

## Phase 6C browser integration

Start `npm run dev` and `npm run realtime:dev` locally. The Examiner case view can create a Live-Session while its local timer is ready; the separate `/medcases/session/join/` page resolves a dynamic code and connects as a read-only Observer. The original `/medcases/join/` static case-code flow remains separate. The Live QR is generated by `QRCodeSVG` and contains only the dynamic join URL and code.

The browser uses `http://127.0.0.1:8787` only in Astro development. For a QR scanned on another device, `PUBLIC_MEDCASES_JOIN_BASE_URL` can override the website origin; otherwise the current browser origin is used. A physical phone cannot reach a QR pointing to `localhost` or `127.0.0.1` on the development computer. Cross-device testing also requires a reachable Worker URL and a matching allowed browser origin in the local Worker; the default setup is intended for two local tabs. No tunnel is created automatically.

The Examiner capability is persisted only in the current tab's `sessionStorage` for reload/reconnect and never enters a URL, QR, log, or durable browser storage. Observer has no timer controls. The browser renders the server's timer state with a local monotonic display anchor and sparse time-sync pings. Old v1 Examiner sessionStorage entries cannot supply a Patient capability; they are removed and a new local session must be created.

## Phase 6D passive display

The Examiner's “Timer-Display hinzufügen” action shows a separate QR and link for `/medcases/session/display/?code=<joinCode>`. The QR contains only this URL and its code—no session ID, case ID, or capability. The route also accepts a manually entered code. Multiple Displays can join one session concurrently with the explicit `display` role. They receive the same timer snapshots, events, and time sync as Observers, but cannot issue any timer command. The UI shows no medical case content and plays no sounds.

The Display uses the existing WebSocket reconnect and server-time anchor. During disconnection, a last-known running timer continues visually with a clear unconfirmed-state warning; paused and ended values stay fixed. A fresh server snapshot supersedes the local projection after reconnect. Native fullscreen and screen Wake Lock are optional, user-triggered enhancements. Wake Lock is released on disable/unmount and reacquired after returning to a visible tab only while the user still requests it. This remains a local prototype, not a production deployment.

Run `node --experimental-strip-types scripts/test-medcases-realtime-ui.mjs` for frontend helpers. The optional browser harness is `node scripts/test-medcases-realtime-browser.mjs` with local Astro/Worker servers and a headless Chrome CDP endpoint on port 9224.

Run `node scripts/test-medcases-realtime-live.mjs` while Wrangler is running. To test persistence, run `node scripts/test-medcases-realtime-live.mjs persistence-create`, restart Wrangler, then run `node scripts/test-medcases-realtime-live.mjs persistence-check`. The test fixture containing the capability is written outside the repository to the system temporary directory and removed by the check.

For the local three-display browser check, run `node scripts/test-medcases-display-browser.mjs` with Astro, Wrangler, and headless Chrome CDP on port 9224. `MEDCASES_TEST_SITE` can select another local Astro origin. The optional `--restart` variant pauses at two markers so Wrangler can be stopped and restarted to verify running and paused reconnect behavior.

## Phase 6E patient and material release

The primary Examiner QR now invites a Patient with `/medcases/session/patient/?code=<joinCode>#access=<patientCapability>`. The capability is only in the fragment, never in the query string or in the Display QR. The Patient entry stages the credential in tab-local `sessionStorage`, immediately strips the fragment, resolves the code, authenticates as `patient`, and navigates to the existing case's patient component in a dedicated noindex/Pagefind-excluded live route. Patient content is rendered only after the authenticated session's opaque case ID matches that route. The static V1 role routes remain available. The Patient sees no countdown.

The Examiner can send `material.release` with one validated material ID. The Durable Object persists only released IDs, and repeats are idempotent; timer reset does not revoke materials. Its medical content and assets stay in the static case definition. A Patient renders a released material only if the ID is also present and explicitly marked releasable in that case. Unknown IDs are ignored. Before release, the material component is absent, so its assets are not deliberately requested. Examiner and Observer retain the existing full technical state; Patient receives case ID and released IDs without timer data, while Display receives only timer data and no material event. Reconnect snapshots restore missed releases without event history.

The only currently releasable demo material is the existing `vitals-1` slot; no new medical material was created. This remains a **local prototype**. Production abuse protection, deployment, and related hardening are deferred. Run `node scripts/test-medcases-patient-browser.mjs` for the local three-role browser flow.
