import type { CreationResult } from 'nessie-node-sdk';

export type MirrorItem = {
  transferId: string;
  amountCents: bigint;
  fromAccountId: string;
  toAccountId: string;
};

type Movement = { medium: 'balance'; amount: number; transaction_date: string; status: 'completed'; description: string };
type Recorded = { _id: string; description?: string };

/**
 * Nessie's live API can't name a recipient on a transfer, so a settlement is
 * recorded as two documented calls: a withdrawal from the payer's account and a
 * deposit into the payee's, linked by a tag in both descriptions.
 */
export interface MoneyGateway {
  withdraw(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  deposit(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  listWithdrawals(accountId: string): Promise<Recorded[]>;
  listDeposits(accountId: string): Promise<Recorded[]>;
}

export type MirrorResult = { withdrawalId: string; depositId: string; created: number };

/** Both Nessie records carry this tag, so the mirror can always find them again. */
export function transferTag(transferId: string): string {
  return `[tab:${transferId}]`;
}

function createdId(result: CreationResult<{ _id: string }>, what: string): string {
  const id = typeof result !== 'string' ? result.objectCreated?._id : undefined;
  if (!id) throw new Error(`Nessie acknowledged the ${what} without returning its id`);
  return id;
}

/**
 * Copies one completed settlement into Nessie (SPEC 12.2). Settlement already
 * happened in SpacetimeDB; this only records it. Each leg is looked up by its tag
 * before it's created, so reruns and restarts never record a payment twice, and
 * the mirror needs no state of its own. Nessie stores whole dollars (deposits
 * reject anything else), so both legs get the nearest dollar, at least $1, and
 * the description keeps the exact amount.
 */
export async function mirrorTransfer(
  item: MirrorItem,
  gateway: MoneyGateway,
  options: { today?: string } = {},
): Promise<MirrorResult> {
  const tag = transferTag(item.transferId);
  const dollars = (Number(item.amountCents) / 100).toFixed(2);
  const movement = (description: string): Movement => ({
    medium: 'balance',
    amount: Math.max(1, Math.round(Number(item.amountCents) / 100)),
    transaction_date: options.today ?? new Date().toISOString().slice(0, 10),
    status: 'completed',
    description: `${description} $${dollars} ${tag}`,
  });
  let created = 0;
  const find = async (list: Promise<Recorded[]>) => (await list).find(r => r.description?.includes(tag))?._id;

  let withdrawalId = await find(gateway.listWithdrawals(item.fromAccountId));
  if (!withdrawalId) {
    withdrawalId = createdId(await gateway.withdraw(item.fromAccountId, movement('Tab settlement sent')), 'withdrawal');
    created++;
  }
  let depositId = await find(gateway.listDeposits(item.toAccountId));
  if (!depositId) {
    depositId = createdId(await gateway.deposit(item.toAccountId, movement('Tab settlement received')), 'deposit');
    created++;
  }
  return { withdrawalId, depositId, created };
}
