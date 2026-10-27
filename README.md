# dead-mans-switch

A Cloudflare Worker that sends a Telegram alert when a scheduled job stops sending pings. It runs on the Workers free plan.

Each check has one Durable Object. A ping moves the alarm of that object to `now + timeout + grace`. If the alarm fires, the Worker sends a "down" alert. The next ping sends a "recovered" alert. At 08:00 UTC each day, the Worker sends a summary of all checks.

## Development environment

The Nix flake supplies Node.js 22. Wrangler and Vitest are dev dependencies in `node_modules`.

1. Run `direnv allow`.
2. Run `npm install`.

## Commands

| Command | Result |
|---|---|
| `npm test` | Runs the tests in the local Workers runtime. |
| `npm run typecheck` | Type-checks `src` and `test`. |
| `npm run types` | Generates `worker-configuration.d.ts` again. Run it after you change `wrangler.toml`. |
| `npm run dev` | Starts a local Worker. Copy `.dev.vars.example` to `.dev.vars` first. |
| `npm run deploy` | Deploys the Worker. |

## Configuration

Add a check to the `[vars.CHECKS]` table in `wrangler.toml`, then deploy again. The values are in seconds:

```toml
[vars.CHECKS]
backup = { timeout = 86400, grace = 3600 }
```

Set the secrets in Cloudflare. Do not put them in the repository:

```sh
npx wrangler secret put PING_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

## Endpoints

Each request needs the token, in the `Authorization: Bearer <token>` header or in `?key=<token>`.

| Endpoint | Result |
|---|---|
| `GET` or `POST /ping/<name>` | `200 ok`. `404` if `<name>` is not in `CHECKS`. |
| `GET /status` | JSON: the state, the last ping, and the deadline of each check. |

A job sends a ping only when it succeeds:

```sh
run-backup && curl -fsS -m 10 --retry 3 \
  -H "Authorization: Bearer $DMS_TOKEN" \
  https://dms.<account>.workers.dev/ping/backup
```
