import 'dotenv/config';
import type { Identity } from 'spacetimedb';
import { connect, disconnect, subscribeBackend } from './connection.js';

const owner = await connect();
let backendIdentity: Identity | undefined;
const backend = await connect({ anonymous: true, onIdentity: identity => { backendIdentity = identity; } });
const subscription = await subscribeBackend(backend);

const waitFor = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for backend-role views');
};

try {
  if (!backendIdentity) throw new Error('SpacetimeDB did not issue an identity');

  const beforeGrant = [
    ...backend.db.backendMessages.iter(),
    ...backend.db.backendGroups.iter(),
    ...backend.db.backendMembers.iter(),
    ...backend.db.backendExpenses.iter(),
  ];
  if (beforeGrant.length !== 0) throw new Error('Unprivileged identity could read backend rows');

  await owner.reducers.grantServiceRole({ identity: backendIdentity, role: 'backend' });
  await waitFor(() => [...backend.db.backendGroups.iter()].length > 0 && [...backend.db.backendMembers.iter()].length > 0);

  const messages = [...backend.db.backendMessages.iter()];
  if (messages.some(message => message.status !== 'new' && message.status !== 'processing')) {
    throw new Error('Backend message view exposed a terminal message');
  }
  const member = [...backend.db.backendMembers.iter()][0];
  if (!member?.phone) throw new Error('Backend member view omitted the phone required for routing');

  console.log(JSON.stringify({
    messages: messages.length,
    groups: [...backend.db.backendGroups.iter()].length,
    members: [...backend.db.backendMembers.iter()].length,
    expenses: [...backend.db.backendExpenses.iter()].length,
    shares: [...backend.db.backendShares.iter()].length,
    transfers: [...backend.db.backendTransfers.iter()].length,
  }, null, 2));
} finally {
  subscription.unsubscribe();
  disconnect(backend);
  disconnect(owner);
}
