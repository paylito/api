# Payli API

HTTP API behind Payli — crypto donation links and the payment orders created from them.

## Running

```bash
npm install
npm run dev      # builds + watches + restarts (compiles to dist/, runs node dist/src/index.js)
# or
npm run build && npm start
```

Configuration is read from environment variables — see [`.env.example`](./.env.example).

Docker Compose loads the current host `.env` through `env_file`; secrets are
excluded from the image. Set `LIFI_API_KEY` in that file and recreate the service
with `docker compose up -d --build --force-recreate payli-api` after this update.
After later key changes, recreating the container is enough. A plain restart
does not reload its environment. For plain Docker, pass `--env-file .env`.
Verify the running container's key without printing it:
`docker compose exec payli-api node scripts/check-lifi.cjs`.

## API documentation

Interactive **Swagger UI** and the raw **OpenAPI 3.0** spec are served by the running app:

| URL             | What                                                               |
| --------------- | ------------------------------------------------------------------ |
| `/swagger`      | Swagger UI (try endpoints in the browser)                          |
| `/swagger.json` | Raw OpenAPI document (import into Postman/Insomnia, client codegen) |
| `/`             | Redirects to `/swagger`                                            |

With the defaults that's <http://localhost:3000/swagger>.

The spec is hand-authored in [`src/configs/swagger.ts`](./src/configs/swagger.ts); keep it in
sync with the handlers in `src/controllers/*` when routes change.

### Endpoints

| Method | Path                    | Description                              |
| ------ | ----------------------- | ---------------------------------------- |
| GET    | `/health`               | Liveness check                           |
| GET    | `/config`               | Supported networks and tokens            |
| GET    | `/donations/{username}` | Public donation link by handle           |
| POST   | `/orders`               | Create an order from a donation link     |
| GET    | `/orders/{id}`          | Get an order by its public short id      |
# Public activity

The admin panel opens to anonymous activity without login. `GET /public/overview`
returns aggregate metrics and recent traces. `GET /public/payments` supports
`page`, `limit` (1–25), `asset`, `network`, `date` (UTC), and `status`.
Swagger documents both routes at `/swagger` and `/swagger.json`.

Gross transfer volume counts a funded payment's reference USD value for the
observed payer deposit, recorded source execution, and a confirmed distinct
destination delivery. A $10 payment can contribute $30. This is
not customer spending or net payout volume. Completed same-chain swaps count
input and output separately even with a shared hash. Same-asset delivery sharing
its source hash counts once. Completed payment volume counts each successful payment once. Unpaid
orders do not count as payments. Registered users includes waitlist accounts
and is not a unique-payer count. Refunded, partial and unconfirmed LI.FI routes
are not completed payments or confirmed destination legs.

Public responses use an explicit allowlist and hashed activity IDs. They omit
usernames, names, wallet addresses, private order IDs, keys, messages, receipts,
and raw provider data. Transaction explorers still expose blockchain addresses.
Payer deposit hashes are recovered with the configured `ALCHEMY_API_KEY` using
its Transfers API. Unsupported networks, unavailable history, provider errors,
or rate limits show an unavailable hash without substituting another leg's hash.
No listener or database migration is required. Admin routes still require JWTs.

Run `npm test` for public route and privacy checks. To also run the MongoDB
integration suite, set `PUBLIC_TEST_DB_URI` to a MongoDB URI. The suite creates
and removes its own randomly named `korre_public_test_*` database and never
uses the application's `DB_NAME`.
