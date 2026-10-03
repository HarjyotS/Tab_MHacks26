import 'dotenv/config';
import { NessieClient } from 'nessie-node-sdk';
import { connect, disconnect, subscribeLedger, subscribeSeederMembers } from './connection.js';
import { transferTag } from './nessie-worker-core.js';

// Run with `npm run nessie:worker` going in another terminal, after seed:demo and seed:nessie.
const LEDGER_SECRET = 'tab-demo-ledger-secret-2026';
const GROUP_ID = 'photon-demo-group';
const EXPENSE_ID = 'expense-frita';
const KIAN_PHONE = '+17345550101';
const KIAN_LEDGER_ID = 'member-kian';
const TRANSFER_ID = `verify-nessie-${Date.now()}`;

const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for verify:nessie');
const nessie = new NessieClient({ apiKey, baseUrl: process.env.NESSIE_BASE_URL || undefined });

const connection = await connect();
const subscriptions = [await subscribeSeederMembers(connection)];

const waitFor = async (description: string, predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

try {
  await connection.reducers.redeemLedgerAccess({ secret: LEDGER_SECRET });
  subscriptions.push(await subscribeLedger(connection));
  const kian = [...connection.db.seederMembers.iter()].find(m => m.memberId === `${GROUP_ID}:${KIAN_PHONE}`);
  if (!kian?.accountId) throw new Error('Kian has no Nessie account. Run npm run seed:nessie first.');

  await connection.reducers.createTransfer({
    transferId: TRANSFER_ID, expenseId: EXPENSE_ID, fromPhone: KIAN_PHONE, approvedByMessageId: 'demo-onboarding-1',
  });
  const transfer = () => connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
  await waitFor('the transfer row', () => !!transfer(), 2_000);
  if (transfer()?.provider !== 'nessie') throw new Error(`Expected the nessie provider, got ${transfer()?.provider}`);

  await waitFor('the Nessie worker to finish the transfer (is npm run nessie:worker running?)', () => {
    const share = [...connection.db.ledgerShares.iter()].find(
      row => row.expenseId === EXPENSE_ID && row.ledgerMemberId === KIAN_LEDGER_ID,
    );
    return ['done', 'failed'].includes(transfer()?.status ?? '') && (transfer()?.status !== 'done' || share?.status === 'paid');
  }, 30_000);
  if (transfer()?.status !== 'done') throw new Error('The Nessie transfer failed; see the worker log');

  const tag = transferTag(TRANSFER_ID);
  const joe = [...connection.db.seederMembers.iter()].find(m => m.memberId === `${GROUP_ID}:+17345550102`);
  const withdrawal = (await nessie.withdrawals.listByAccount(kian.accountId)).find(r => r.description?.includes(tag));
  const deposit = (await nessie.deposits.listByAccount(joe!.accountId!)).find(r => r.description?.includes(tag));
  if (!withdrawal || !deposit) throw new Error('SpacetimeDB says done, but Nessie is missing the withdrawal or deposit');

  console.log(JSON.stringify({
    transferId: TRANSFER_ID,
    provider: transfer()?.provider,
    status: transfer()?.status,
    amount: `$${(Number(transfer()!.amountCents) / 100).toFixed(2)}`,
    nessieWithdrawal: { id: withdrawal._id, from: 'Kian', amount: withdrawal.amount, description: withdrawal.description },
    nessieDeposit: { id: deposit._id, to: 'Joe', amount: deposit.amount, description: deposit.description },
  }, null, 2));
} finally {
  for (const s of subscriptions) s.unsubscribe();
  disconnect(connection);
}
