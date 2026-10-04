import { type Identity } from 'spacetimedb';
import { DbConnection, tables, type SubscriptionHandle } from './module_bindings/index.js';

export type TabConnection = DbConnection;

export function connect(options: { anonymous?: boolean; onIdentity?: (identity: Identity) => void } = {}): Promise<DbConnection> {
  const uri = process.env.SPACETIME_HOST ?? 'http://127.0.0.1:3000';
  const database = process.env.SPACETIME_DB ?? 'tab-local';
  const token = options.anonymous ? undefined : process.env.SPACETIME_AUTH_TOKEN;

  return new Promise((resolve, reject) => {
    let builder = DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(database)
      .onConnect((connection, identity) => {
        options.onIdentity?.(identity);
        resolve(connection);
      })
      .onConnectError((_ctx, error) => reject(error));
    if (token) builder = builder.withToken(token);
    builder.build();
  });
}

export function subscribeSeederMembers(connection: DbConnection): Promise<SubscriptionHandle> {
  return new Promise((resolve, reject) => {
    let handle: SubscriptionHandle;
    handle = connection.subscriptionBuilder()
      .onApplied(() => resolve(handle))
      .onError(ctx => reject(new Error(String(ctx.event))))
      .subscribe(tables.seederMembers);
  });
}

export function subscribeLedger(connection: DbConnection): Promise<SubscriptionHandle> {
  return new Promise((resolve, reject) => {
    let handle: SubscriptionHandle;
    handle = connection.subscriptionBuilder()
      .onApplied(() => resolve(handle))
      .onError(ctx => reject(new Error(String(ctx.event))))
      .subscribe([
        tables.ledgerGroups,
        tables.ledgerMembers,
        tables.ledgerExpenses,
        tables.ledgerShares,
        tables.ledgerItems,
        tables.ledgerClaims,
        tables.ledgerTransfers,
        tables.ledgerBalances,
      ]);
  });
}

export function subscribeBackend(connection: DbConnection): Promise<SubscriptionHandle> {
  return new Promise((resolve, reject) => {
    let handle: SubscriptionHandle;
    handle = connection.subscriptionBuilder()
      .onApplied(() => resolve(handle))
      .onError(ctx => reject(new Error(String(ctx.event))))
      .subscribe([
        tables.backendMessages,
        tables.backendGroups,
        tables.backendGroupSettings,
        tables.backendMembers,
        tables.backendOutbox,
        tables.backendExpenses,
        tables.backendLineItems,
        tables.backendClaims,
        tables.backendShares,
        tables.backendTransfers,
      ]);
  });
}

export function disconnect(connection: DbConnection): void {
  connection.disconnect();
}
