import 'dotenv/config';
import { Identity } from 'spacetimedb';
import { DbConnection, tables } from './module_bindings/index.js';
import { connect, disconnect } from './connection.js';

// Run after seed:demo. A fresh identity must see nothing through the backend views;
// once the owner grants it the backend role, it must see full rows, phones included.
const uri = process.env.SPACETIME_HOST ?? 'http://127.0.0.1:3000';
const database = process.env.SPACETIME_DB ?? 'tab-local';
const views = [
  tables.backendMessages, tables.backendGroups, tables.backendMembers, tables.backendOutbox, tables.backendExpenses,
  tables.backendLineItems, tables.backendClaims, tables.backendShares, tables.backendTransfers,
];

function open(token?: string): Promise<{ conn: DbConnection; identity: string; token: string }> {
  return new Promise((resolve, reject) => {
    let builder = DbConnection.builder().withUri(uri).withDatabaseName(database)
      .onConnect((conn, identity, newToken) => resolve({ conn, identity: identity.toHexString(), token: newToken }))
      .onConnectError((_ctx, error) => reject(error));
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

async function counts(conn: DbConnection): Promise<Record<string, number>> {
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder().onApplied(() => resolve()).onError(ctx => reject(new Error(String(ctx.event)))).subscribe(views);
  });
  const db = conn.db;
  return Object.fromEntries(Object.entries({
    messages: db.backendMessages.count(), groups: db.backendGroups.count(), members: db.backendMembers.count(),
    expenses: db.backendExpenses.count(), shares: db.backendShares.count(), transfers: db.backendTransfers.count(),
  }).map(([name, n]) => [name, Number(n)]));
}

const stranger = await open();
const before = await counts(stranger.conn);
disconnect(stranger.conn);
if (Object.values(before).some(n => n > 0)) throw new Error(`An unprivileged identity can read backend views: ${JSON.stringify(before)}`);

const owner = await connect();
await owner.reducers.grantServiceRole({ identity: Identity.fromString(stranger.identity), role: 'backend' });
disconnect(owner);

const backend = await open(stranger.token);
const after = await counts(backend.conn);
const phone = [...backend.conn.db.backendMembers.iter()][0]?.phone;
disconnect(backend.conn);
if (Object.values(after).some(n => n === 0)) throw new Error(`The backend role can't see every table: ${JSON.stringify(after)}`);
if (!phone) throw new Error('Backend members are missing phone numbers');
console.log(JSON.stringify({ unprivileged: before, backendRole: after, memberPhoneVisible: true }, null, 2));
