import 'dotenv/config';
import { Timestamp } from 'spacetimedb';
import { connect, disconnect, subscribeBackend } from './connection.js';

// The module side of the site's promises (SPEC 7.6, 19), against a real
// SpacetimeDB: STOP skips DMs, payments are reported then confirmed (or
// rejected) by the payee, handles are validated, and forget_person removes a
// person while the group's amounts still add up. Point it at a throwaway
// database: it claims module ownership if nobody has.
//   SPACETIME_HOST=http://127.0.0.1:3077 SPACETIME_DB=tab-verify npm run verify:promises
const RUN = Date.now().toString(36);
const GROUP = `verify-promises-${RUN}`;
const JOE = '+15555550101';
const KIAN = '+15555550102';
const PRIYA = '+15555550104';
const PEOPLE = [JOE, KIAN, PRIYA];

const db = await connect();
await db.reducers.claimModuleOwner({}).catch(() => undefined); // fine if this identity already owns it
const subscription = await subscribeBackend(db);

const waitFor = async (what: string, ok: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (ok()) return;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`timed out: ${what}`);
};
const rejects = async (what: string, call: Promise<unknown>) => {
  await call.then(() => { throw new Error(`expected a rejection: ${what}`); }, () => undefined);
};
const check = (what: string, ok: boolean) => {
  if (!ok) throw new Error(`failed: ${what}`);
  console.log(`ok  ${what}`);
};

let seq = 0;
const say = async (phone: string, text = 'hi') => {
  const messageId = `${RUN}-m${++seq}`;
  await db.reducers.ingestMessage({
    messageId, groupId: GROUP, groupLedgerId: `${GROUP}-ledger`, groupDisplayName: 'verify', groupTimezone: 'America/Detroit',
    senderPhone: phone, senderLedgerMemberId: `${GROUP}-${phone}`, isDm: false, kind: 'text', text, imageUrl: undefined,
    replyToId: undefined, reaction: undefined, receivedAt: Timestamp.now(),
  });
  await waitFor(`message ${messageId}`, () => Boolean(db.db.backendMessages.messageId.find(messageId)));
  return messageId;
};
const share = (expenseId: string, phone: string) => db.db.backendShares.shareId.find(`${expenseId}:${phone}`);

async function finalized(expenseId: string, total: bigint) {
  const base = {
    expenseId, groupId: GROUP, payerPhone: JOE, description: 'Pizza', sourceMessageId: `src-${expenseId}`, splitMode: 'even',
    subtotalCents: undefined, taxCents: 0n, tipCents: 0n, feesCents: 0n, discountCents: 0n, totalCents: total,
    objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined, settleMessageId: `settle-${RUN}`,
  };
  await db.reducers.upsertExpense({ ...base, status: 'proposed', finalizedAt: undefined });
  for (const phone of PEOPLE)
    await db.reducers.setShare({ expenseId, phone, role: phone === JOE ? 'payer' : 'participant', status: 'locked', fixedCents: undefined, responded: true, followupCount: 0, lastFollowupAt: undefined });
  await db.reducers.upsertExpense({ ...base, status: 'finalized', finalizedAt: Timestamp.now() });
  await waitFor(`finalized ${expenseId}`, () => db.db.backendExpenses.expenseId.find(expenseId)?.status === 'finalized');
}

try {
  for (const p of PEOPLE) await say(p);

  // STOP: no more DMs, except the one confirming it.
  await db.reducers.setOptOut({ phone: PRIYA, optedOut: true });
  await waitFor('opt-out', () => db.db.backendPeople.phone.find(PRIYA)?.optedOut === true);
  const dm = (actionId: string, purpose: string) => db.reducers.enqueueOutbox({
    actionId, kind: 'dm', groupId: undefined, toPhone: PRIYA, targetMessageId: undefined, text: 'hi', reaction: undefined,
    expenseId: undefined, purpose, sendAfter: Timestamp.now(),
  });
  await dm(`${RUN}-blocked`, 'other');
  await dm(`${RUN}-confirm`, 'opt_out');
  await waitFor('confirmation queued', () => Boolean(db.db.backendOutbox.actionId.find(`${RUN}-confirm`)));
  check('a DM to someone who texted STOP is skipped', !db.db.backendOutbox.actionId.find(`${RUN}-blocked`));
  check('the STOP confirmation still goes out', Boolean(db.db.backendOutbox.actionId.find(`${RUN}-confirm`)));
  await db.reducers.setOptOut({ phone: PRIYA, optedOut: false });

  // Handles are validated.
  await rejects('a too-short Venmo username', db.reducers.setPaymentHandle({ phone: JOE, venmo: 'joe', cashtag: undefined }));
  await rejects('a $cashtag with no letters', db.reducers.setPaymentHandle({ phone: JOE, venmo: undefined, cashtag: '12345' }));
  await db.reducers.setPaymentHandle({ phone: JOE, venmo: 'joe-smith', cashtag: undefined });
  await db.reducers.setPaymentHandle({ phone: JOE, venmo: undefined, cashtag: 'joecash' });
  await waitFor('handles', () => db.db.backendPeople.phone.find(JOE)?.cashtag === 'joecash');
  check('a second handle keeps the first', db.db.backendPeople.phone.find(JOE)?.venmo === 'joe-smith');

  // Reported by the person who owed, confirmed by the payee.
  const pizza = `${RUN}-pizza`;
  await finalized(pizza, 3000n);
  const sent = await say(KIAN, 'sent');
  await rejects("someone else reporting Kian's payment", db.reducers.recordPayment({ transferId: `${RUN}-t0`, expenseId: pizza, fromPhone: KIAN, messageId: await say(PRIYA, 'x'), provider: 'venmo' }));
  await rejects('an unknown provider', db.reducers.recordPayment({ transferId: `${RUN}-t1`, expenseId: pizza, fromPhone: KIAN, messageId: sent, provider: 'zelle' }));
  await db.reducers.recordPayment({ transferId: `${RUN}-t1`, expenseId: pizza, fromPhone: KIAN, messageId: sent, provider: 'venmo' });
  await db.reducers.recordPayment({ transferId: `${RUN}-t1b`, expenseId: pizza, fromPhone: KIAN, messageId: sent, provider: 'venmo' }); // a repeat: nothing new
  await waitFor('reported', () => db.db.backendTransfers.transferId.find(`${RUN}-t1`)?.status === 'reported');
  check('a report waits on the payee', share(pizza, KIAN)?.status === 'approved' && !db.db.backendTransfers.transferId.find(`${RUN}-t1b`));
  await rejects('Kian confirming his own payment', db.reducers.confirmPayment({ transferId: `${RUN}-t1`, messageId: await say(KIAN, 'yep') }));
  await db.reducers.confirmPayment({ transferId: `${RUN}-t1`, messageId: await say(JOE, 'got it') });
  await waitFor('confirmed', () => share(pizza, KIAN)?.status === 'paid');
  check('the payee confirms: paid', db.db.backendTransfers.transferId.find(`${RUN}-t1`)?.status === 'done');

  // Rejected by the payee: owed again. Then the payee's own word settles it.
  const nope = await say(PRIYA, 'sent');
  await db.reducers.recordPayment({ transferId: `${RUN}-t2`, expenseId: pizza, fromPhone: PRIYA, messageId: nope, provider: 'cashapp' });
  await db.reducers.rejectPayment({ transferId: `${RUN}-t2`, messageId: await say(JOE, 'nope') });
  await waitFor('rejected', () => share(pizza, PRIYA)?.status === 'locked');
  check('the payee says no: owed again', db.db.backendTransfers.transferId.find(`${RUN}-t2`)?.status === 'failed');
  await db.reducers.recordPayment({ transferId: `${RUN}-t3`, expenseId: pizza, fromPhone: PRIYA, messageId: await say(JOE, 'priya paid me'), provider: 'other' });
  await waitFor('payee recorded', () => share(pizza, PRIYA)?.status === 'paid');
  await waitFor('settled', () => db.db.backendExpenses.expenseId.find(pizza)?.status === 'settled');
  check('"priya paid me" from the payee settles it, and the expense with it', true);

  // A $0 expense still missing details can be dropped.
  const vague = `${RUN}-vague`;
  const vagueRow = {
    expenseId: vague, groupId: GROUP, payerPhone: undefined, description: 'Expense', sourceMessageId: `src-${vague}`, splitMode: 'even',
    subtotalCents: undefined, taxCents: 0n, tipCents: 0n, feesCents: 0n, discountCents: 0n, totalCents: 0n,
    objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined, settleMessageId: undefined, finalizedAt: undefined,
  };
  await db.reducers.upsertExpense({ ...vagueRow, status: 'needs_info' });
  await db.reducers.upsertExpense({ ...vagueRow, status: 'void' });
  await waitFor('dropped', () => db.db.backendExpenses.expenseId.find(vague)?.status === 'void');
  check('a needs_info expense with no amount can be dropped', true);

  // forget_person: Kian is gone, the amounts stay.
  const tacos = `${RUN}-tacos`;
  await finalized(tacos, 4500n);
  await say(KIAN, 'my venmo is kian-l');
  await db.reducers.setPaymentHandle({ phone: KIAN, venmo: 'kian-l', cashtag: undefined });
  await db.reducers.forgetPerson({ phone: KIAN });
  await waitFor('forgotten', () => !share(tacos, KIAN));
  const shares = [...db.db.backendShares.iter()].filter(s => s.expenseId === tacos);
  check('their shares move to a placeholder', shares.some(s => s.phone.startsWith('forgotten:')) && !shares.some(s => s.phone === KIAN));
  check('the amounts still add up', shares.reduce((n, s) => n + s.amountCents, 0n) === 4500n);
  check('their messages are gone', ![...db.db.backendMessages.iter()].some(m => m.senderPhone === KIAN));
  check('their words are cleared', [...db.db.backendMessages.iter()].filter(m => m.senderPhone.startsWith('forgotten:')).every(m => m.text === undefined));
  check('they left the group', [...db.db.backendMembers.iter()].filter(m => m.groupId === GROUP && m.phone.startsWith('forgotten:')).every(m => m.leftAt !== undefined && m.name === undefined));
  check('their transfers point to the placeholder', ![...db.db.backendTransfers.iter()].some(t => t.fromPhone === KIAN || t.toPhone === KIAN));
  const kept = db.db.backendPeople.phone.find(KIAN);
  check('only the opt-out is kept', kept?.optedOut === true && kept.venmo === undefined && kept.cashtag === undefined);

  console.log('\nall promise checks passed');
} finally {
  subscription.unsubscribe();
  disconnect(db);
}
