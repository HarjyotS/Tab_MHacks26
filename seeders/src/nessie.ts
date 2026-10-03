import 'dotenv/config';
import { NessieClient } from 'nessie-node-sdk';
import { connect, disconnect, subscribeSeederMembers } from './connection.js';
import { provisionMember, type NessieGateway, type SeedMember } from './nessie-core.js';

const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for seed:nessie');

const startingBalance = BigInt(process.env.DEMO_STARTING_BALANCE ?? '50000');
const forceNew = process.argv.includes('--force-new');
const nessie = new NessieClient({
  apiKey,
  baseUrl: process.env.NESSIE_BASE_URL || undefined,
});

const gateway: NessieGateway = {
  createCustomer: input => nessie.customers.create(input),
  createAccount: (customerId, input) => nessie.accounts.create(customerId, input),
  createDeposit: (accountId, input) => nessie.deposits.create(accountId, input),
};

const connection = await connect();
const subscription = await subscribeSeederMembers(connection);

try {
  const rows = [...connection.db.seederMembers.iter()];
  if (rows.length === 0) throw new Error('No members exist. Run npm run seed:demo first.');

  const results: SeedMember[] = [];
  for (const row of rows) {
    const member: SeedMember = {
      memberId: row.memberId, groupId: row.groupId, phone: row.phone, name: row.name,
      customerId: row.customerId, accountId: row.accountId,
      depositCreated: row.depositCreated, seededBalanceCents: row.seededBalanceCents,
    };
    results.push(await provisionMember(member, gateway, {
      save: progress => connection.reducers.setNessieIds({
        memberId: progress.memberId, customerId: progress.customerId,
        accountId: progress.accountId, depositCreated: progress.depositCreated,
        seededBalanceCents: progress.seededBalanceCents,
      }),
    }, { forceNew, startingBalanceCents: startingBalance }));
  }

  console.table(results.map(member => ({
    member: member.name ?? member.memberId,
    customerId: member.customerId,
    accountId: member.accountId,
    seededBalance: `$${(Number(member.seededBalanceCents) / 100).toFixed(2)}`,
  })));
} finally {
  subscription.unsubscribe();
  disconnect(connection);
}
