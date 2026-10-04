import 'dotenv/config';
import { connect, disconnect } from './connection.js';

// Usage (owner or backend/seeder token): npm run set:ledger-secret -- <group_id> <secret>
const [groupId, secret] = process.argv.slice(2);
if (!groupId || !secret) {
  console.error('Usage: npm run set:ledger-secret -- <group_id> <secret of at least 24 characters>');
  process.exit(1);
}

const connection = await connect();
try {
  await connection.reducers.setLedgerSecret({ groupId, secret });
  console.log(`Ledger URL: /g/${secret}`);
} finally {
  disconnect(connection);
}
