import 'dotenv/config';
import { connect, disconnect, subscribeLedger } from './connection.js';

const LEDGER_SECRET = 'tab-demo-ledger-secret-2026';
const connection = await connect({ anonymous: true });
let subscription: Awaited<ReturnType<typeof subscribeLedger>> | undefined;

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for redeemed ledger views');
};

try {
  subscription = await subscribeLedger(connection);
  if ([...connection.db.ledgerGroups.iter()].length !== 0) {
    throw new Error('Anonymous identity could read a ledger before redeeming its secret');
  }

  await connection.reducers.redeemLedgerAccess({ secret: LEDGER_SECRET });
  await waitFor(() => [...connection.db.ledgerGroups.iter()].length === 1 && [...connection.db.ledgerMembers.iter()].length === 3);

  const rows = [
    ...connection.db.ledgerGroups.iter(),
    ...connection.db.ledgerMembers.iter(),
    ...connection.db.ledgerExpenses.iter(),
    ...connection.db.ledgerShares.iter(),
    ...connection.db.ledgerTransfers.iter(),
  ];
  const forbidden = rows.flatMap(row => Object.keys(row)).filter(key => /phone|nessie|secret/i.test(key));
  if (forbidden.length) throw new Error(`Ledger views exposed forbidden fields: ${[...new Set(forbidden)].join(', ')}`);

  console.log(`Redeemed one group with ${[...connection.db.ledgerMembers.iter()].length} opaque members; no phone, Nessie, or secret fields exposed.`);
} finally {
  subscription?.unsubscribe();
  disconnect(connection);
}
