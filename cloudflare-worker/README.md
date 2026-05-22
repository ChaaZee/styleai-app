# Stitch Depop Proxy Worker

Cloudflare Worker that proxies requests to the Depop API on behalf of the Render backend.
Runs on CF edge so Depop's Cloudflare protection doesn't block it.

## Setup

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

## Env vars (set via Cloudflare dashboard or `wrangler secret put`)

| Variable | Description |
|---|---|
| `WORKER_SECRET` | Shared secret — must match `WORKER_SECRET` env var on Render |
| `DEPOP_SESSION_ID` | Your Depop session cookie (`depop-session-id` header) — refresh when blocked |

## Updating session cookies

When Depop starts blocking (Cloudflare challenge responses):
1. Open depop.com while logged in
2. DevTools → Network → find any `webapi.depop.com` request
3. Copy the `depop-session-id` and `depop-device-id` header values
4. Update via: `wrangler secret put DEPOP_SESSION_ID`

## Usage

`POST /fetch` with body `{ "url": "https://webapi.depop.com/..." }`
Header: `Authorization: Bearer <WORKER_SECRET>`
