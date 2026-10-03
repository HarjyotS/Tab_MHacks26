import 'dotenv/config';
import { Timestamp } from 'spacetimedb';
import { connect, disconnect, subscribeSeederMembers } from './connection.js';

const GROUP_ID = 'photon-demo-group';
const LEDGER_ID = 'ledger-demo-house';
const LEDGER_SECRET = 'tab-demo-ledger-secret-2026';
const members = [
  { phone: '+17345550101', name: 'Kian', ledgerId: 'member-kian' },
  { phone: '+17345550102', name: 'Joe', ledgerId: 'member-joe' },
  { phone: '+17345550103', name: 'Priya', ledgerId: 'member-priya' },
];

const connection = await connect();
await connection.reducers.claimModuleOwner({});
const subscription = await subscribeSeederMembers(connection);

try {
  if ([...connection.db.seederMembers.iter()].some(member => member.groupId === GROUP_ID)) {
    console.log(`Demo data already exists. Ledger URL: /g/${LEDGER_SECRET}`);
    process.exitCode = 0;
  } else {
    for (const [index, member] of members.entries()) {
      await connection.reducers.ingestMessage({
        messageId: `demo-onboarding-${index + 1}`, groupId: GROUP_ID, groupLedgerId: LEDGER_ID,
        groupDisplayName: 'State Street House', groupTimezone: 'America/Detroit',
        senderPhone: member.phone, senderLedgerMemberId: member.ledgerId,
        isDm: false, kind: 'text', text: `I am ${member.name}`,
        imageUrl: undefined, replyToId: undefined, reaction: undefined, receivedAt: Timestamp.now(),
      });
      await connection.reducers.setMemberName({ memberId: `${GROUP_ID}:${member.phone}`, name: member.name });
    }
    await connection.reducers.setGroupStatus({ groupId: GROUP_ID, status: 'active' });
    await connection.reducers.setLedgerSecret({ groupId: GROUP_ID, secret: LEDGER_SECRET });
    await connection.reducers.setDemoMode({ enabled: true });

    await connection.reducers.upsertExpense({
      expenseId: 'expense-frita', groupId: GROUP_ID, payerPhone: members[1].phone,
      description: 'Frita Batidos', sourceMessageId: 'demo-expense-frita', splitMode: 'itemized',
      status: 'itemizing', subtotalCents: 8000n, taxCents: 600n, tipCents: 1600n,
      feesCents: 0n, discountCents: 0n, totalCents: 10200n,
      objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined,
      settleMessageId: 'demo-settle-frita', finalizedAt: undefined,
    });
    for (const member of members) {
      await connection.reducers.setShare({
        expenseId: 'expense-frita', phone: member.phone,
        role: member.phone === members[1].phone ? 'payer' : 'participant', status: 'awaiting_claim',
        fixedCents: undefined, responded: false, followupCount: 0, lastFollowupAt: undefined,
      });
    }
    await connection.reducers.setLineItems({ expenseId: 'expense-frita', items: [
      { itemId: 'frita-burger', position: 1, description: 'Cuban burger', quantity: 1, amountCents: 3000n },
      { itemId: 'frita-chorizo', position: 2, description: 'Chorizo burger', quantity: 1, amountCents: 2000n },
      { itemId: 'frita-batidos', position: 3, description: 'Batidos', quantity: 2, amountCents: 3000n },
    ] });
    await connection.reducers.addClaim({ itemId: 'frita-burger', phone: members[0].phone, sourceMessageId: 'demo-claim-1' });
    await connection.reducers.addClaim({ itemId: 'frita-chorizo', phone: members[1].phone, sourceMessageId: 'demo-claim-2' });
    await connection.reducers.addClaim({ itemId: 'frita-batidos', phone: members[2].phone, sourceMessageId: 'demo-claim-3' });
    for (const member of members) {
      await connection.reducers.setShare({
        expenseId: 'expense-frita', phone: member.phone,
        role: member.phone === members[1].phone ? 'payer' : 'participant', status: 'locked',
        fixedCents: undefined, responded: true, followupCount: 0, lastFollowupAt: undefined,
      });
    }
    await connection.reducers.upsertExpense({
      expenseId: 'expense-frita', groupId: GROUP_ID, payerPhone: members[1].phone,
      description: 'Frita Batidos', sourceMessageId: 'demo-expense-frita', splitMode: 'itemized',
      status: 'finalized', subtotalCents: 8000n, taxCents: 600n, tipCents: 1600n,
      feesCents: 0n, discountCents: 0n, totalCents: 10200n,
      objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined,
      settleMessageId: 'demo-settle-frita', finalizedAt: Timestamp.now(),
    });

    await connection.reducers.upsertExpense({
      expenseId: 'expense-pizza', groupId: GROUP_ID, payerPhone: members[0].phone,
      description: 'Pizza House', sourceMessageId: 'demo-expense-pizza', splitMode: 'even',
      status: 'proposed', subtotalCents: 4800n, taxCents: 0n, tipCents: 0n,
      feesCents: 0n, discountCents: 0n, totalCents: 4800n,
      objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined,
      settleMessageId: 'demo-settle-pizza', finalizedAt: undefined,
    });
    for (const member of members) {
      await connection.reducers.setShare({
        expenseId: 'expense-pizza', phone: member.phone,
        role: member.phone === members[0].phone ? 'payer' : 'participant', status: 'locked',
        fixedCents: undefined, responded: true, followupCount: 0, lastFollowupAt: undefined,
      });
    }
    await connection.reducers.upsertExpense({
      expenseId: 'expense-pizza', groupId: GROUP_ID, payerPhone: members[0].phone,
      description: 'Pizza House', sourceMessageId: 'demo-expense-pizza', splitMode: 'even',
      status: 'finalized', subtotalCents: 4800n, taxCents: 0n, tipCents: 0n,
      feesCents: 0n, discountCents: 0n, totalCents: 4800n,
      objectionDeadline: undefined, claimDeadline: undefined, proposalMessageId: undefined,
      settleMessageId: 'demo-settle-pizza', finalizedAt: Timestamp.now(),
    });
    for (let index = 1; index < members.length; index += 1) {
      await connection.reducers.seedCompletedTransfer({
        transferId: `historic-pizza-${index}`, expenseId: 'expense-pizza', fromPhone: members[index].phone,
        approvedByMessageId: `historic-approval-${index}`, completedAt: Timestamp.now(),
      });
    }
    console.log(`Seeded demo group. Ledger URL: /g/${LEDGER_SECRET}`);
  }
} finally {
  subscription.unsubscribe();
  disconnect(connection);
}
