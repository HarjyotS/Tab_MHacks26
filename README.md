# Tab

The group-chat agent that keeps the tab. SpacetimeDB is the runtime source of truth for expenses, deterministic split math, approvals, scheduled simulated settlement, and the live ledger. Nessie is used only by a setup-time seeder to create mock banking profiles.

## Requirements

- Node.js 22 or newer
- SpacetimeDB CLI 2.10.x

Install dependencies and copy the environment template:

```powershell
npm install
Copy-Item .env.example .env
```

## Local setup

Start SpacetimeDB, publish the module, and generate its typed bindings:

```powershell
spacetime start
spacetime publish --server local tab-local -p spacetime
npm run bindings
```

Use the publishing identity token as `SPACETIME_AUTH_TOKEN` when running privileged seed commands. Seed a deterministic group and open the printed private ledger URL:

```powershell
npm run seed:demo
npm run dev -w web
```

The default demo ledger is `/g/tab-demo-ledger-secret-2026`. The URL redeems access for the browser's persisted anonymous SpacetimeDB identity; raw financial tables remain private.

The web app connects to the shared Maincloud database by default. For local development, set `VITE_SPACETIME_HOST=ws://127.0.0.1:3000` and `VITE_SPACETIME_DB=tab-local` in `.env` before starting Vite; restart Vite after changing these values.

The hosted ledger is deployed to GitHub Pages on every push to `main` that touches `web/` (`.github/workflows/pages.yml`): `https://kien-le-trung.github.io/Tab_MHacks26/g/<secret>`. Set the backend's `LEDGER_BASE_URL` to `https://kien-le-trung.github.io/Tab_MHacks26`. To mint a link by hand, run `npm run set:ledger-secret -- <group_id> <secret>` with an owner or backend token.

## Optional Nessie fixtures

Set `NESSIE_API_KEY`, then provision one mock customer, checking account, and starting deposit per demo member:

```powershell
npm run seed:nessie
```

The command checkpoints the customer ID, account ID, and deposit state in SpacetimeDB after each step. It is safe to rerun. Use `npm run seed:nessie -- --force-new` only when a fresh set of Nessie fixtures is intentional.

Settlement never depends on Nessie: SpacetimeDB completes it itself. Run the mirror to record each completed settlement in Nessie and keep each member's bank balance in step:

```powershell
npm run nessie:mirror            # one run
npm run nessie:mirror:forever    # restarts it if it exits (use this next to the live backend)
```

What the mirror does, as the seeder role or owner:
- **Opens accounts.** A named member with no Nessie account gets a customer, a checking account and the `DEMO_STARTING_BALANCE` deposit, with ids saved through `set_nessie_ids`. Set `NESSIE_GROUPS=<group_id>,…` to do this only for those groups. Set `NESSIE_AUTO_PROVISION=off` to turn it off.
- **Records settlements** as a withdrawal from the payer and a deposit to the payee, tagged `[tab:<transfer_id>]`. Nessie's transfer endpoint has no payee field. Each record is looked up by tag before it's created, so restarts never record twice. Progress (`recorded` or `failed`, dollars, attempts, error) goes to `nessie_mirror_progress`. Failures retry after 2s, 8s, 32s and 2 min, then stay `failed` until the next restart.
- **Rounds to whole dollars with a carry.** Nessie keeps whole dollars, so each account's remainder carries over: its total in Nessie stays within 50 cents of the exact cents in SpacetimeDB. The exact amount is in each description.
- **Syncs balances.** Nessie's sandbox never changes an account's own `balance` after it's opened; deposits, withdrawals, transfers and updates all leave it unchanged. So the mirror computes each balance from Nessie's records (opening balance + completed deposits − completed withdrawals) and stores it in `nessie_balances`. The ledger shows it under "Bank balances".

Run exactly one mirror at a time; two could both record the same settlement.

## Verification

```powershell
npm test
npm run typecheck
npm run build
```

The SpacetimeDB module tests cover the contractual split vectors and money edge cases. Seeder tests cover idempotent reruns and recovery after interrupted provisioning.

With a seeded local database running, the acceptance checks exercise scheduled settlement and anonymous ledger-link redemption:

```powershell
npm run verify:settlement
npm run verify:access
npm run verify:nessie            # with nessie:mirror running, after seed:nessie
npm run verify:nessie-balances   # Nessie vs SpacetimeDB per member (within $1); add --group=<id> for one group
```
