import 'dotenv/config';
import { Identity } from 'spacetimedb';
import { connect, disconnect } from './connection.js';

// Usage (module owner's token in SPACETIME_AUTH_TOKEN): npm run grant:role -- <identity hex> <client|backend|seeder>
const [identityHex, role] = process.argv.slice(2);
if (!identityHex || !['client', 'backend', 'seeder'].includes(role ?? '')) {
  console.error('Usage: npm run grant:role -- <identity hex> <client|backend|seeder>');
  process.exit(1);
}

const connection = await connect();
try {
  await connection.reducers.grantServiceRole({ identity: Identity.fromString(identityHex), role: role! });
  console.log(`Granted ${role} to ${identityHex}.`);
} finally {
  disconnect(connection);
}
