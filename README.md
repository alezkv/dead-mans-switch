# dead-mans-switch

A Cloudflare Worker that sends a Telegram alert when a scheduled job stops sending pings. It runs on the Workers free plan.

Each check has one Durable Object. A ping moves the alarm of that object to `now + timeout`. If the alarm fires, the Worker sends a "down" alert. The next ping sends a "recovered" alert. At 08:00 UTC each day, the Worker sends a summary of all checks.

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

The repository has no list of checks. The checks are in the `CHECKS` secret, so their names stay private.

Keep the list in a JSON file outside the repository. `timeout` is the longest time between two pings, in seconds. Include a margin for a slow job and a late alarm. For a daily job, 25 hours is a good value:

```json
{
  "backup": { "timeout": 90000 }
}
```

Set the secrets in Cloudflare. Do not put them in the repository:

```sh
npx wrangler secret put PING_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put CHECKS < path/to/checks.json
```

To change the checks, edit the file and run the last command again. You do not have to deploy the code again. If `CHECKS` is not valid, each ping returns an error and no check is deleted.

For `npm run dev`, put `CHECKS` in `.dev.vars` on one line. `.dev.vars.example` has a sample. The tests set their own `CHECKS` in `vitest.config.ts`.

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
