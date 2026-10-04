import 'dotenv/config';
import { NessieClient, NessieHttpError } from 'nessie-node-sdk';
import { connect, disconnect, subscribeNessieMirror, subscribeSeederMembers } from './connection.js';
import { nessieBalanceCents } from './nessie-worker-core.js';

// Reconciles Nessie with SpacetimeDB for every member with a Nessie account:
//   expected = starting balance + settlements received - settlements paid (SpacetimeDB, exact cents)
//   nessie   = opening balance + completed deposits - completed withdrawals (Nessie's records)
// They may differ by under $1 (Nessie keeps whole dollars). Also checks every
// completed settlement between two Nessie accounts is marked recorded.
// Exits 1 on any drift or unrecorded settlement. Read-only.
const TOLERANCE_CENTS = 100n;
const apiKey = process.env.NESSIE_API_KEY;
if (!apiKey) throw new Error('NESSIE_API_KEY is required for verify:nessie-balances');
const nessie = new NessieClient({ apiKey, baseUrl: process.env.NESSIE_BASE_URL || undefined });
const orEmpty = async <T>(list: Promise<T[]>): Promise<T[]> => {
  try {
    return await list;
  } catch (err) {
    if (err instanceof NessieHttpError && err.status === 404) return [];
    throw err;
  }
};
const money = (cents: bigint) => `${cents < 0n ? '-' : ''}$${(Number(cents < 0n ? -cents : cents) / 100).toFixed(2)}`;
const group = process.argv.find(a => a.startsWith('--group='))?.slice('--group='.length);

const connection = await connect();
const subscriptions = [await subscribeSeederMembers(connection), await subscribeNessieMirror(connection)];
let failed = false;
try {
  const settlements = [...connection.db.nessieMirror.iter()];
  const unrecorded = settlements.filter(s => s.mirrorStatus !== 'recorded' && (!group || s.fromMemberId.startsWith(`${group}:`)));
  const rows = [];
  for (const m of connection.db.seederMembers.iter()) {
    if (!m.accountId || (group && m.groupId !== group)) continue;
    const received = settlements.filter(s => s.toMemberId === m.memberId).reduce((sum, s) => sum + s.amountCents, 0n);
    const paid = settlements.filter(s => s.fromMemberId === m.memberId).reduce((sum, s) => sum + s.amountCents, 0n);
    const expected = m.seededBalanceCents + received - paid;
    const account = await nessie.accounts.get(m.accountId);
    const [deposits, withdrawals] = await Promise.all([
      orEmpty(nessie.deposits.listByAccount(m.accountId)), orEmpty(nessie.withdrawals.listByAccount(m.accountId)),
    ]);
    const actual = nessieBalanceCents(Number(account.balance ?? 0), deposits, withdrawals);
    const drift = actual - expected;
    const ok = (drift < 0n ? -drift : drift) < TOLERANCE_CENTS;
    if (!ok) failed = true;
    rows.push({
      member: m.name ?? m.memberId, start: money(m.seededBalanceCents), received: money(received), paid: money(paid),
      expected: money(expected), nessie: money(actual), drift: money(drift), ok: ok ? 'yes' : 'NO',
    });
  }
  console.table(rows);
  if (unrecorded.length) {
    failed = true;
    console.log('Settlements not recorded in Nessie yet:');
    console.table(unrecorded.map(s => ({ transfer: s.transferId, amount: money(s.amountCents), status: s.mirrorStatus ?? 'never tried', attempts: s.attempts })));
  }
  console.log(failed ? 'Nessie does NOT match SpacetimeDB.' : 'Nessie matches SpacetimeDB (within $1 per member).');
} finally {
  for (const s of subscriptions) s.unsubscribe();
  disconnect(connection);
}
process.exit(failed ? 1 : 0);
