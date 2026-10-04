import 'dotenv/config';
import { NessieClient, NessieHttpError } from 'nessie-node-sdk';
import { connect, disconnect, subscribeNessieMirror, subscribeSeederMembers } from './connection.js';
import { provisionMember, type NessieGateway } from './nessie-core.js';
import {
  MAX_ATTEMPTS, mirrorTransfer, nessieBalanceCents, plannedDollars, retryDelayMs,
  type MirrorItem, type MoneyGateway,
} from './nessie-worker-core.js';

// Optional, non-blocking: settlement completes in SpacetimeDB whether or not this runs.
// It records each completed settlement in Nessie, opens Nessie accounts for named members
// who have none, and keeps each member's balance (as Nessie's records show it) in SpacetimeDB.
const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for nessie:mirror');
const nessie = new NessieClient({ apiKey, baseUrl: process.env.NESSIE_BASE_URL || undefined });
const autoProvision = !/^(off|false|0|no)$/i.test(process.env.NESSIE_AUTO_PROVISION ?? 'on');
const startingBalance = BigInt(process.env.DEMO_STARTING_BALANCE ?? '50000');
// Only open accounts in these groups (comma-separated group ids); unset means every group.
const onlyGroups = new Set((process.env.NESSIE_GROUPS ?? '').split(',').map(g => g.trim()).filter(Boolean));
const inScope = (groupId: string) => onlyGroups.size === 0 || onlyGroups.has(groupId);

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
const seedGateway: NessieGateway = {
  createCustomer: input => nessie.customers.create(input),
  createAccount: (customerId, input) => nessie.accounts.create(customerId, input),
  createDeposit: (accountId, input) => nessie.deposits.create(accountId, input),
};

// A mirror that silently lost SpacetimeDB would stop recording, so exit loudly instead
// (nessie:mirror:forever restarts it). Run exactly one mirror: two could both record a settlement.
let running = true;
const connection = await connect({
  onDisconnect: error => {
    if (!running) return; // our own shutdown, not a lost connection
    console.error(`Lost the SpacetimeDB connection${error ? `: ${error.message}` : ''}. Restart the mirror.`);
    process.exit(1);
  },
});
const subscriptions = [await subscribeNessieMirror(connection), await subscribeSeederMembers(connection)];
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const money = (cents: bigint) => `$${(Number(cents) / 100).toFixed(2)}`;

// --- accounts for members who have none -------------------------------------------------
const provisionFailed = new Set<string>();
async function provisionMissing(): Promise<void> {
  if (!autoProvision) return;
  for (const row of connection.db.seederMembers.iter()) {
    // Wait for a name: the account is opened in it. Done once both ids and the deposit exist.
    if (!inScope(row.groupId) || !row.name || (row.accountId && row.depositCreated) || provisionFailed.has(row.memberId)) continue;
    try {
      const member = await provisionMember({
        memberId: row.memberId, groupId: row.groupId, phone: row.phone, name: row.name,
        customerId: row.customerId, accountId: row.accountId,
        depositCreated: row.depositCreated, seededBalanceCents: row.seededBalanceCents,
      }, seedGateway, {
        save: p => connection.reducers.setNessieIds({
          memberId: p.memberId, customerId: p.customerId, accountId: p.accountId,
          depositCreated: p.depositCreated, seededBalanceCents: p.seededBalanceCents,
        }),
      }, { forceNew: false, startingBalanceCents: startingBalance });
      log(`opened a Nessie account for ${row.name} (${row.memberId}): ${member.accountId}, ${money(startingBalance)}`);
      if (member.accountId) await syncBalance(row.memberId, member.accountId);
    } catch (err) {
      provisionFailed.add(row.memberId); // retried after a restart, not in a tight loop
      console.error(`${row.memberId}: couldn't open a Nessie account: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// --- balances, as Nessie's records show them --------------------------------------------
async function syncBalance(memberId: string, accountId: string): Promise<void> {
  const account = await nessie.accounts.get(accountId);
  const [deposits, withdrawals] = await Promise.all([gateway.listDeposits(accountId), gateway.listWithdrawals(accountId)]);
  const cents = nessieBalanceCents(Number(account.balance ?? 0), deposits, withdrawals);
  await connection.reducers.setNessieBalance({ memberId, balanceCents: cents });
}
async function syncAllBalances(): Promise<void> {
  for (const row of connection.db.seederMembers.iter()) {
    if (!row.accountId) continue;
    try {
      await syncBalance(row.memberId, row.accountId);
    } catch (err) {
      console.error(`${row.memberId}: balance sync failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// --- settlements --------------------------------------------------------------------------
// What this process recorded, merged over the view until the subscription catches up.
const local = new Map<string, Pick<MirrorItem, 'mirrorStatus' | 'withdrawnDollars' | 'depositedDollars'>>();
const attempts = new Map<string, number>();
const nextTry = new Map<string, number>();
const items = (): MirrorItem[] =>
  [...connection.db.nessieMirror.iter()].map(row => ({ ...row, ...local.get(row.transferId) }));

async function drain(): Promise<void> {
  const all = items();
  for (const item of all) {
    if (item.mirrorStatus === 'recorded') continue;
    const tries = attempts.get(item.transferId) ?? 0;
    if (tries >= MAX_ATTEMPTS || (nextTry.get(item.transferId) ?? 0) > Date.now()) continue;
    try {
      const result = await mirrorTransfer(item, gateway, { dollars: plannedDollars(item, items()) });
      const done = { mirrorStatus: 'recorded', withdrawnDollars: BigInt(result.dollars.withdraw), depositedDollars: BigInt(result.dollars.deposit) };
      local.set(item.transferId, done);
      await connection.reducers.recordNessieMirror({
        transferId: item.transferId, status: 'recorded',
        withdrawnDollars: done.withdrawnDollars, depositedDollars: done.depositedDollars,
        withdrawalId: result.withdrawalId, depositId: result.depositId, attempts: tries + 1, error: undefined,
      });
      log(`${item.transferId}: ${money(item.amountCents)} recorded in Nessie ($${result.dollars.withdraw} out, $${result.dollars.deposit} in${result.created ? '' : ', already there'})`);
      for (const [member, account] of [[item.fromMemberId, item.fromAccountId], [item.toMemberId, item.toAccountId]]) {
        if (member) await syncBalance(member, account!).catch(err => console.error(`${member}: balance sync failed: ${err}`));
      }
    } catch (err) {
      const n = tries + 1;
      const message = err instanceof Error ? err.message : String(err);
      attempts.set(item.transferId, n);
      nextTry.set(item.transferId, Date.now() + retryDelayMs(n));
      console.error(`${item.transferId}: Nessie mirror failed (${n}/${MAX_ATTEMPTS}): ${message}`);
      await connection.reducers.recordNessieMirror({
        transferId: item.transferId, status: 'failed', withdrawnDollars: 0n, depositedDollars: 0n,
        withdrawalId: undefined, depositId: undefined, attempts: n, error: message.slice(0, 300),
      }).catch(e => console.error(`${item.transferId}: couldn't save the failure: ${e}`));
    }
  }
}

process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
log(`Nessie mirror watching for completed settlements${autoProvision ? `; opening accounts for named members${onlyGroups.size ? ` in ${[...onlyGroups].join(', ')}` : ''}` : ''}.`);
let lastFullSync = 0;
try {
  while (running) {
    await provisionMissing();
    await drain();
    if (Date.now() - lastFullSync > 60_000) {
      await syncAllBalances();
      lastFullSync = Date.now();
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally {
  for (const s of subscriptions) s.unsubscribe();
  disconnect(connection);
}
