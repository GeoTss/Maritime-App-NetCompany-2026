# Maritime-App-NetCompany-2026

Pharos — Smart Maritime Operations Assistant (hackathon prototype). Design: `docs/MASTER_PLAN.md`.

## Run it

```bash
npm_config_cache=$PWD/.npm-cache npm ci
npm run verify
LLM_MODE=replay docker compose up -d --build   # db :5432, erp :4100, api :4000
```

- Until `ANTHROPIC_API_KEY` is set in `.env` (needed from Phase 2), start the stack with `LLM_MODE=replay`; in the default `live` mode the API refuses to start and names the missing variable.
- On boot the API migrates the database and reseeds the synthetic world anchored to the boot time (`SEED_ON_BOOT=reset|if-empty|off`, `WORLD_SEED`). Reseed by hand with `npm run db:seed`.
- Ports and sea routes are real (UN/LOCODEs; Eurostat maritime network via `searoute-ts`, precomputed by `npm run db:routes -w @pharos/db`). Vessels, suppliers, prices and quotes are synthetic.
