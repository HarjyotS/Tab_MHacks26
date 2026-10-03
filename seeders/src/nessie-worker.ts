import 'dotenv/config';
import { NessieClient, NessieHttpError } from 'nessie-node-sdk';
import { connect, disconnect, subscribeNessieWork } from './connection.js';
import { executeTransfer, type MoneyGateway, type Outcome, type WorkItem } from './nessie-worker-core.js';

const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for nessie:worker');

const nessie = new NessieClient({ apiKey, baseUrl: process.env.NESSIE_BASE_URL || undefined });
// Nessie answers an empty list with HTTP 404 "No … found".
async function orEmpty<T>(list: Promise<T[]>): Promise<T[]> {
  try {
    return await list;
  } catch (err) {
    if (err instanceof NessieHttpError && err.status === 404) return [];
    throw err;
  }
}

const gateway: MoneyGateway = {
  withdraw: (accountId, input) => nessie.withdrawals.create(accountId, input),
  deposit: (accountId, input) => nessie.deposits.create(accountId, input),
  listWithdrawals: accountId => orEmpty(nessie.withdrawals.listByAccount(accountId)),
  listDeposits: accountId => orEmpty(nessie.deposits.listByAccount(accountId)),
};

// A worker that silently lost SpacetimeDB would never see new approvals, so exit loudly instead.
const connection = await connect({
  onDisconnect: error => {
    console.error(`Lost the SpacetimeDB connection${error ? `: ${error.message}` : ''}. Restart the worker.`);
    process.exit(1);
  },
});
const subscription = await subscribeNessieWork(connection);
const store = {
  update: (transferId: string, status: 'submitted' | 'done' | 'failed', outcome: Outcome = {}) =>
    connection.reducers.updateTransfer({
      transferId, status,
      nessieWithdrawalId: outcome.withdrawalId, nessieDepositId: outcome.depositId, error: outcome.error,
    }),
};

// Each transfer is handled once per process; the view drops it once it's done or failed.
const inFlight = new Set<string>();
async function drain(): Promise<void> {
  for (const row of connection.db.nessieWork.iter()) {
    if (inFlight.has(row.transferId)) continue;
    inFlight.add(row.transferId);
    const item: WorkItem = {
      transferId: row.transferId, status: row.status, amountCents: row.amountCents,
      fromAccountId: row.fromAccountId, toAccountId: row.toAccountId,
    };
    const outcome = await executeTransfer(item, gateway, store);
    console.log(`${new Date().toISOString()} ${row.transferId}: $${(Number(row.amountCents) / 100).toFixed(2)} ${outcome}`);
  }
}

let running = true;
const stop = () => { running = false; };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Nessie worker watching for approved transfers.');
try {
  while (running) {
    await drain().catch(err => console.error('Nessie worker:', err));
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally {
  subscription.unsubscribe();
  disconnect(connection);
}
