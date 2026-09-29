# MedCases Realtime – Phase 6A

This Worker is a local technical prototype. It does not replace the existing static MedCases pages and must not be deployed as a public session service. Run it with `npm run realtime:dev` and test the pure state logic with `npm run realtime:test`. `npm run realtime:typecheck` generates local Worker runtime types and checks the isolated Worker TypeScript project. Wrangler stores local Durable Object data under `.wrangler/`, which Git ignores.

`GET /health` is the only route available without the explicit `ENVIRONMENT=development` value supplied by the local npm script. Development-only routes are:

- `POST /__dev/sessions/<sessionId>` with JSON `sessionId`, `caseId`, `durationSeconds`, and `warningRemainingSeconds` to initialize a test session;
- `GET /__dev/sessions/<sessionId>/connect?role=examiner|observer` for WebSocket connections;
- `GET /__dev/sessions/<sessionId>/state` to inspect persisted test state.

Session IDs must match `session_` plus 20 lowercase hexadecimal characters and should be generated with a cryptographically secure random generator. These routes have **no production authentication**. Query-selected roles are only a local test mechanism and must never become production authorization. Browser origins are restricted to the local Astro development origins; non-browser clients without an Origin header are accepted only while the development routes are enabled.

The Worker stores only an opaque session ID, an opaque case ID, timer timestamps/status, expiry, and released material IDs. It does not store medical case content, personal data, checklists, or notes. The development retention is one hour. The server sends state changes and alarm events, never a per-second countdown; clients can use `serverNowMs` and `time.ping`/`time.pong` to estimate clock offset later. SQLite-backed Durable Object storage and hibernatable WebSockets retain state across object restarts. The static case definition remains in this repository.

The local integration test is `node scripts/test-medcases-realtime-live.mjs` while Wrangler is running. A persistence check can be run with `persistence-create`, a Wrangler restart, then `persistence-check <sessionId>`. Production session creation, join codes, authenticated role capabilities, and UI integration belong to later phases.
