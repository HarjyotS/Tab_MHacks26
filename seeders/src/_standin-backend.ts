// TEMPORARY stand-in for Joe's backend, for the live M1 test only. Not committed.
import 'dotenv/config';
import { Timestamp } from 'spacetimedb';
import { connect, subscribeBackend } from './connection.js';

const conn = await connect();
await subscribeBackend(conn);
const greeted = new Set<string>();
const handled = new Set<string>();
console.log('stand-in backend up');
setInterval(async () => {
  for (const g of conn.db.backendGroups.iter()) {
    if (g.groupId.startsWith('iMessage;') && !greeted.has(g.groupId)) {
      greeted.add(g.groupId);
      await conn.reducers.enqueueOutbox({ actionId: `m1-hello-${g.groupId}-${Date.now()}`, kind: 'group_message', groupId: g.groupId,
        toPhone: undefined, targetMessageId: undefined, reaction: undefined, expenseId: undefined, purpose: 'other', sendAfter: Timestamp.now(),
        text: 'Tab test: connected end to end (iMessage → SpacetimeDB → backend → iMessage). Text "@tab ping" and I\'ll answer.' });
      console.log('greeted', g.groupId);
    }
  }
  for (const m of conn.db.backendMessages.iter()) {
    if (handled.has(m.messageId) || m.status !== 'new') continue;
    handled.add(m.messageId);
    const ping = m.kind === 'text' && /^@?tab ping$/i.test((m.text ?? '').trim());
    if (ping && m.groupId) {
      await conn.reducers.enqueueOutbox({ actionId: `m1-pong-${m.messageId}`, kind: 'group_message', groupId: m.groupId, toPhone: undefined,
        targetMessageId: undefined, reaction: undefined, expenseId: undefined, purpose: 'other', sendAfter: Timestamp.now(),
        text: 'pong (round trip through SpacetimeDB)' });
      console.log('pong for', m.messageId);
    }
    if (m.kind === 'reaction') console.log(`reaction ${m.reaction} from ${m.senderPhone.slice(-4)} on ${m.replyToId}`);
    await conn.reducers.setMessageResult({ messageId: m.messageId, intent: ping ? 'help' : 'ignore', confidence: 1, status: 'done', error: undefined });
  }
}, 1000);
