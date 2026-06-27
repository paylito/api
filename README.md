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
