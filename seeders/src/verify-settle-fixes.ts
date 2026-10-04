import 'dotenv/config';
import { Timestamp } from 'spacetimedb';
import { connect, disconnect, subscribeBackend } from './connection.js';

// Run after `npm run seed:demo`. Creates its own expenses (suffixed per run), so it can be re-run.
const GROUP_ID = 'photon-demo-group';
const RUN = Date.now().toString(36);
const JOE = '+17345550102';
const HARJYOT = '+17345550101';
const DHANUSH = '+17345550103';
const TANUJ = '+17345550104';
const PEOPLE = [JOE, HARJYOT, DHANUSH, TANUJ];

const owner = await connect();
const outsider = await connect({ anonymous: true });
const subscription = await subscribeBackend(owner);
const outsiderSubscription = await subscribeBackend(outsider);

const waitFor = async (description: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const expectReject = async (description: string, call: Promise<unknown>): Promise<void> => {
  await call.then(
    () => { throw new Error(`Expected rejection: ${description}`); },
    () => undefined,
  );
};

const share = (expenseId: string, phone: string) => owner.db.backendShares.shareId.find(`${expenseId}:${phone}`);

/** Creates a finalized, evenly split expense paid by Joe. */
const finalizedExpense = async (expenseId: string, totalCents: bigint): Promise<void> => {
  const expense = {
    expenseId, groupId: GROUP_ID, payerPhone: JOE, description: `Verify ${expenseId}`,
    sourceMessageId: `source-${expenseId}`, splitMode: 'even', subtotalCents: totalCents,
    taxCents: 0n, tipCents: 0n, feesCents: 0n, discountCents: 0n, totalCents,
    objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined,
    settleMessageId: `settle-${RUN}`,
  };
  await owner.reducers.upsertExpense({ ...expense, status: 'proposed', finalizedAt: undefined });
  for (const phone of PEOPLE) {
    await owner.reducers.setShare({
      expenseId, phone, role: phone === JOE ? 'payer' : 'participant', status: 'locked',
      fixedCents: undefined, responded: true, followupCount: 0, lastFollowupAt: undefined,
    });
  }
  await owner.reducers.upsertExpense({ ...expense, status: 'finalized', finalizedAt: Timestamp.now() });
  await waitFor(`finalized ${expenseId}`, () => owner.db.backendExpenses.expenseId.find(expenseId)?.status === 'finalized'
    && PEOPLE.every(phone => share(expenseId, phone)?.amountCents === totalCents / BigInt(PEOPLE.length)));
};

const ingest = (messageId: string, groupId: string, senderPhone: string, extra: { groupLedgerId?: string; senderLedgerMemberId?: string } = {}) =>
  owner.reducers.ingestMessage({
    messageId, groupId, groupLedgerId: extra.groupLedgerId, groupDisplayName: undefined,
    groupTimezone: 'America/Detroit', senderPhone, senderLedgerMemberId: extra.senderLedgerMemberId,
    isDm: false, kind: 'reaction', text: undefined, imageUrl: undefined, replyToId: `settle-${RUN}`,
    reaction: 'like', receivedAt: Timestamp.now(),
  });

try {
  if (!owner.db.backendGroups.groupId.find(GROUP_ID)) throw new Error('Run `npm run seed:demo` first');

  // (a) One approval message pays shares in two different finalized expenses.
  const expenseA = `verify-settle-a-${RUN}`;
  const expenseB = `verify-settle-b-${RUN}`;
  await finalizedExpense(expenseA, 4000n);
  await finalizedExpense(expenseB, 8000n);
  const approval = `verify-approval-${RUN}`;
  await ingest(approval, GROUP_ID, HARJYOT);

  await expectReject('another member using Harjyot’s approval', owner.reducers.createTransfer({
    transferId: `verify-transfer-wrong-${RUN}`, expenseId: expenseA, fromPhone: DHANUSH, approvedByMessageId: approval,
  }));
  await owner.reducers.createTransfer({ transferId: `verify-transfer-a-${RUN}`, expenseId: expenseA, fromPhone: HARJYOT, approvedByMessageId: approval });
  await owner.reducers.createTransfer({ transferId: `verify-transfer-b-${RUN}`, expenseId: expenseB, fromPhone: HARJYOT, approvedByMessageId: approval });
  await waitFor('two transfers from one approval', () =>
    !!owner.db.backendTransfers.transferId.find(`verify-transfer-a-${RUN}`) && !!owner.db.backendTransfers.transferId.find(`verify-transfer-b-${RUN}`));
  // Same (approval, expense) pair again: idempotent no-op.
  await owner.reducers.createTransfer({ transferId: `verify-transfer-a-dup-${RUN}`, expenseId: expenseA, fromPhone: HARJYOT, approvedByMessageId: approval });
  await new Promise(resolve => setTimeout(resolve, 200));
  const approvalTransfers = [...owner.db.backendTransfers.iter()].filter(row => row.approvedByMessageId === approval);
  if (owner.db.backendTransfers.transferId.find(`verify-transfer-a-dup-${RUN}`) || approvalTransfers.length !== 2) {
    throw new Error(`Expected exactly 2 transfers for the approval, found ${approvalTransfers.length}`);
  }
  const amounts = Object.fromEntries(approvalTransfers.map(row => [row.expenseId, row.amountCents]));
  if (amounts[expenseA] !== 1000n || amounts[expenseB] !== 2000n) throw new Error('Transfers have the wrong amounts');
  await waitFor('both shares paid', () => share(expenseA, HARJYOT)?.status === 'paid' && share(expenseB, HARJYOT)?.status === 'paid');
  if (share(expenseA, DHANUSH)?.status !== 'locked') throw new Error('Approval affected another member’s share');

  // (b) Settle mode: default ledger, stores and reads back, rejects bad values.
  const settleGroup = `verify-settle-group-${RUN}`;
  await ingest(`verify-settle-group-msg-${RUN}`, settleGroup, HARJYOT, {
    groupLedgerId: `ledger-${settleGroup}`, senderLedgerMemberId: `member-${settleGroup}`,
  });
  const mode = () => owner.db.backendGroupSettings.groupId.find(settleGroup)?.settleMode;
  await waitFor('default settle mode', () => mode() === 'ledger');
  const defaultMode = mode();
  await owner.reducers.setSettleMode({ groupId: settleGroup, settleMode: 'per_expense' });
  await waitFor('per_expense settle mode', () => mode() === 'per_expense');
  await expectReject('a bad settle mode', owner.reducers.setSettleMode({ groupId: settleGroup, settleMode: 'weekly' }));
  await expectReject('an unknown group', owner.reducers.setSettleMode({ groupId: `missing-${RUN}`, settleMode: 'ledger' }));
  await expectReject('settle mode from an identity without a role', outsider.reducers.setSettleMode({ groupId: settleGroup, settleMode: 'ledger' }));
  if (mode() !== 'per_expense') throw new Error('Rejected calls changed the settle mode');
  if ([...outsider.db.backendGroupSettings.iter()].length !== 0) throw new Error('Unprivileged identity could read group settings');
  await owner.reducers.setSettleMode({ groupId: settleGroup, settleMode: 'ledger' });
  await waitFor('ledger settle mode', () => mode() === 'ledger');

  // (c) resolve_dispute: the disputer's amount changes, the payer absorbs the difference.
  const expenseC = `verify-settle-c-${RUN}`;
  await finalizedExpense(expenseC, 9000n); // 2250 each
  await owner.reducers.setShare({
    expenseId: expenseC, phone: DHANUSH, role: 'participant', status: 'disputed',
    fixedCents: undefined, responded: true, followupCount: 0, lastFollowupAt: undefined,
  });
  await waitFor('disputed share', () => share(expenseC, DHANUSH)?.status === 'disputed');
  await expectReject('a non-disputed share', owner.reducers.resolveDispute({ expenseId: expenseC, phone: TANUJ, amountCents: 1000n }));
  await expectReject('the payer’s share', owner.reducers.resolveDispute({ expenseId: expenseC, phone: JOE, amountCents: 1000n }));
  await expectReject('a negative amount', owner.reducers.resolveDispute({ expenseId: expenseC, phone: DHANUSH, amountCents: -1n }));
  await expectReject('a negative payer share', owner.reducers.resolveDispute({ expenseId: expenseC, phone: DHANUSH, amountCents: 4501n }));
  await expectReject('a dispute from an identity without a role', outsider.reducers.resolveDispute({ expenseId: expenseC, phone: DHANUSH, amountCents: 1500n }));
  await owner.reducers.resolveDispute({ expenseId: expenseC, phone: DHANUSH, amountCents: 1500n });
  await waitFor('resolved dispute', () => share(expenseC, DHANUSH)?.status === 'locked');
  const resolved = Object.fromEntries(PEOPLE.map(phone => [phone, share(expenseC, phone)!.amountCents]));
  const sum = Object.values(resolved).reduce((total, amount) => total + amount, 0n);
  if (resolved[DHANUSH] !== 1500n || resolved[JOE] !== 3000n || resolved[HARJYOT] !== 2250n || resolved[TANUJ] !== 2250n || sum !== 9000n) {
    throw new Error(`Unexpected shares after resolving: ${JSON.stringify(resolved, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
  }
  await expectReject('resolving an already locked share', owner.reducers.resolveDispute({ expenseId: expenseC, phone: DHANUSH, amountCents: 1000n }));
  // The resolved share is payable again.
  const reapproval = `verify-reapproval-${RUN}`;
  await ingest(reapproval, GROUP_ID, DHANUSH);
  await owner.reducers.createTransfer({ transferId: `verify-transfer-c-${RUN}`, expenseId: expenseC, fromPhone: DHANUSH, approvedByMessageId: reapproval });
  await waitFor('resolved share transfer', () => owner.db.backendTransfers.transferId.find(`verify-transfer-c-${RUN}`)?.amountCents === 1500n);

  console.log(JSON.stringify({
    oneApprovalManyShares: { approval, transfers: approvalTransfers.map(row => `${row.expenseId}=${row.amountCents}`), duplicateIgnored: true },
    settleMode: { defaultMode, afterSet: 'per_expense', badValueRejected: true, final: mode() },
    resolveDispute: { expense: expenseC, shares: resolved, totalCents: sum, invalidCasesRejected: 6 },
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
} finally {
  subscription.unsubscribe();
  outsiderSubscription.unsubscribe();
  disconnect(outsider);
  disconnect(owner);
}
