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

## Optional Nessie fixtures

Set `NESSIE_API_KEY`, then provision one mock customer, checking account, and starting deposit per demo member:

```powershell
npm run seed:nessie
```

The command checkpoints the customer ID, account ID, and deposit state in SpacetimeDB after each step. It is safe to rerun. Use `npm run seed:nessie -- --force-new` only when a fresh set of Nessie fixtures is intentional.

Settlement never depends on Nessie: SpacetimeDB completes it itself. Optionally, run the mirror to record each completed settlement in Nessie as a withdrawal from the payer and a deposit to the payee:

```powershell
npm run nessie:mirror
```

Run exactly one mirror at a time. It reads the `nessie_mirror` view (seeder role or owner), tags both records `[tab:<transfer_id>]`, and looks them up by tag before creating anything, so restarts never record twice. It never writes to SpacetimeDB. Nessie stores whole dollars only, so the exact amount stays in SpacetimeDB and in each description.

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
npm run verify:nessie   # with nessie:mirror running, after seed:nessie
```
