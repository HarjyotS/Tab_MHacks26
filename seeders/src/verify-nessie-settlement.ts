import 'dotenv/config';
import { NessieClient } from 'nessie-node-sdk';
import { connect, disconnect, subscribeLedger, subscribeSeederMembers } from './connection.js';
import { transferTag } from './nessie-worker-core.js';

// Run with `npm run nessie:mirror` going in another terminal, after seed:demo and seed:nessie.
// Checks that settlement completes in SpacetimeDB on its own, then shows up in Nessie.
const LEDGER_SECRET = 'tab-demo-ledger-secret-2026';
const GROUP_ID = 'photon-demo-group';
const EXPENSE_ID = 'expense-frita';
const KIAN = '+17345550101';
const JOE = '+17345550102';
const TRANSFER_ID = `verify-nessie-${Date.now()}`;

const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for verify:nessie');
const nessie = new NessieClient({ apiKey, baseUrl: process.env.NESSIE_BASE_URL || undefined });

const waitFor = async <T>(description: string, check: () => T | undefined | Promise<T | undefined>, timeoutMs: number): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const connection = await connect();
const subscriptions = [await subscribeSeederMembers(connection)];
try {
  await connection.reducers.redeemLedgerAccess({ secret: LEDGER_SECRET });
  subscriptions.push(await subscribeLedger(connection));
  const account = (phone: string) =>
    [...connection.db.seederMembers.iter()].find(m => m.memberId === `${GROUP_ID}:${phone}`)?.accountId;
  if (!account(KIAN) || !account(JOE)) throw new Error('Kian or Joe has no Nessie account. Run npm run seed:nessie first.');

  await connection.reducers.createTransfer({
    transferId: TRANSFER_ID, expenseId: EXPENSE_ID, fromPhone: KIAN, approvedByMessageId: 'demo-onboarding-1',
  });
  const settled = await waitFor('simulated settlement in SpacetimeDB', () => {
    const t = connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
    return t?.status === 'done' ? t : undefined;
  }, 10_000);

  const tag = transferTag(TRANSFER_ID);
  const recorded = await waitFor('the mirror to record it in Nessie (is npm run nessie:mirror running?)', async () => {
    const withdrawal = (await nessie.withdrawals.listByAccount(account(KIAN)!).catch(() => [])).find(r => r.description?.includes(tag));
    const deposit = (await nessie.deposits.listByAccount(account(JOE)!).catch(() => [])).find(r => r.description?.includes(tag));
    return withdrawal && deposit ? { withdrawal, deposit } : undefined;
  }, 30_000);

  console.log(JSON.stringify({
    transferId: TRANSFER_ID,
    spacetime: { provider: settled.provider, status: settled.status, amount: `$${(Number(settled.amountCents) / 100).toFixed(2)}` },
    nessieWithdrawal: { id: recorded.withdrawal._id, from: 'Kian', amount: recorded.withdrawal.amount, description: recorded.withdrawal.description },
    nessieDeposit: { id: recorded.deposit._id, to: 'Joe', amount: recorded.deposit.amount, description: recorded.deposit.description },
  }, null, 2));
} finally {
  for (const s of subscriptions) s.unsubscribe();
  disconnect(connection);
}
