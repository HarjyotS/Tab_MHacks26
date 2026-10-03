import 'dotenv/config';
import { connect, disconnect, subscribeLedger } from './connection.js';

const LEDGER_SECRET = 'tab-demo-ledger-secret-2026';
const EXPENSE_ID = 'expense-frita';
const TRANSFER_ID = `verify-transfer-${Date.now()}`;
const KIAN_PHONE = '+17345550101';
const KIAN_LEDGER_ID = 'member-kian';
const PRIYA_PHONE = '+17345550103';
const PRIYA_LEDGER_ID = 'member-priya';
const APPROVAL_MESSAGE_ID = 'demo-onboarding-1';

const connection = await connect();
let subscription: Awaited<ReturnType<typeof subscribeLedger>> | undefined;

const waitFor = async (description: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

try {
  await connection.reducers.redeemLedgerAccess({ secret: LEDGER_SECRET });
  subscription = await subscribeLedger(connection);

  const before = [...connection.db.ledgerShares.iter()].find(
    share => share.expenseId === EXPENSE_ID && share.ledgerMemberId === KIAN_LEDGER_ID,
  );
  if (!before || before.status !== 'locked' || before.amountCents <= 0n) {
    throw new Error('Expected Kian to have an unpaid, locked Frita share');
  }

  await connection.reducers.createTransfer({
    transferId: `${TRANSFER_ID}-wrong-debtor`,
    expenseId: EXPENSE_ID,
    fromPhone: PRIYA_PHONE,
    approvedByMessageId: APPROVAL_MESSAGE_ID,
  }).then(
    () => { throw new Error('A member was able to use another participant’s approval'); },
    () => undefined,
  );

  await connection.reducers.createTransfer({
    transferId: TRANSFER_ID,
    expenseId: EXPENSE_ID,
    fromPhone: KIAN_PHONE,
    approvedByMessageId: APPROVAL_MESSAGE_ID,
  });

  await waitFor('the pending transfer', () => {
    const transfer = connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
    return transfer?.status === 'pending';
  }, 500);

  const pending = connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
  if (!pending || pending.provider !== 'spacetime_simulated') {
    throw new Error('Pending transfer did not use the simulated provider');
  }


  await connection.reducers.createTransfer({
    transferId: `${TRANSFER_ID}-duplicate`,
    expenseId: EXPENSE_ID,
    fromPhone: KIAN_PHONE,
    approvedByMessageId: APPROVAL_MESSAGE_ID,
  });
  if (connection.db.ledgerTransfers.transferId.find(`${TRANSFER_ID}-duplicate`)) {
    throw new Error('Duplicate approval created another transfer');
  }
  const approvalTransfers = [...connection.db.ledgerTransfers.iter()].filter(
    transfer => transfer.expenseId === EXPENSE_ID && transfer.fromLedgerMemberId === KIAN_LEDGER_ID,
  );
  if (approvalTransfers.length !== 1) {
    throw new Error('Duplicate approval did not remain idempotent');
  }

  await waitFor('scheduled settlement completion', () => {
    const transfer = connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
    const share = [...connection.db.ledgerShares.iter()].find(
      row => row.expenseId === EXPENSE_ID && row.ledgerMemberId === KIAN_LEDGER_ID,
    );
    return transfer?.status === 'done' && share?.status === 'paid';
  });

  const completed = connection.db.ledgerTransfers.transferId.find(TRANSFER_ID);
  const priyaShare = [...connection.db.ledgerShares.iter()].find(
    row => row.expenseId === EXPENSE_ID && row.ledgerMemberId === PRIYA_LEDGER_ID,
  );
  const expense = connection.db.ledgerExpenses.expenseId.find(EXPENSE_ID);
  if (priyaShare?.status !== 'locked' || expense?.status !== 'finalized') {
    throw new Error('Completing Kian’s transfer changed another share or settled the expense early');
  }
  const balanceEdge = [...connection.db.ledgerBalances.iter()].find(
    edge => edge.fromLedgerMemberId === KIAN_LEDGER_ID && edge.toLedgerMemberId === completed?.toLedgerMemberId,
  );
  console.log(JSON.stringify({
    transferId: completed?.transferId,
    provider: completed?.provider,
    status: completed?.status,
    shareStatus: 'paid',
    otherShareStatus: priyaShare.status,
    expenseStatus: expense.status,
    remainingEdgeCents: balanceEdge?.amountCents ?? 0n,
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
} finally {
  subscription?.unsubscribe();
  disconnect(connection);
}
