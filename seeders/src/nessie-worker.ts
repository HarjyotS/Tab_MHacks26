import 'dotenv/config';
import { NessieClient, NessieHttpError } from 'nessie-node-sdk';
import { connect, disconnect, subscribeNessieMirror } from './connection.js';
import { mirrorTransfer, type MoneyGateway } from './nessie-worker-core.js';

// Optional, non-blocking: settlement completes in SpacetimeDB whether or not this runs.
const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for nessie:mirror');
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

// A mirror that silently lost SpacetimeDB would stop recording, so exit loudly instead.
const connection = await connect({
  onDisconnect: error => {
    console.error(`Lost the SpacetimeDB connection${error ? `: ${error.message}` : ''}. Restart the mirror.`);
    process.exit(1);
  },
});
const subscription = await subscribeNessieMirror(connection);

const mirrored = new Set<string>();
const failures = new Map<string, number>();
async function drain(): Promise<void> {
  for (const row of connection.db.nessieMirror.iter()) {
    if (mirrored.has(row.transferId) || (failures.get(row.transferId) ?? 0) >= 3) continue;
    try {
      const result = await mirrorTransfer(row, gateway);
      mirrored.add(row.transferId);
      if (result.created) {
        console.log(`${new Date().toISOString()} ${row.transferId}: $${(Number(row.amountCents) / 100).toFixed(2)} recorded in Nessie (withdrawal ${result.withdrawalId}, deposit ${result.depositId})`);
      }
    } catch (err) {
      failures.set(row.transferId, (failures.get(row.transferId) ?? 0) + 1);
      console.error(`${row.transferId}: Nessie mirror failed (${failures.get(row.transferId)}/3): ${err instanceof Error ? err.message : err}`);
    }
  }
}

let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
console.log('Nessie mirror watching for completed settlements.');
try {
  while (running) {
    await drain();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  subscription.unsubscribe();
  disconnect(connection);
}
