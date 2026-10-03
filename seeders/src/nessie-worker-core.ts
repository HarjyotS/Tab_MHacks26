import type { CreationResult } from 'nessie-node-sdk';

export type WorkItem = {
  transferId: string;
  status: string;
  amountCents: bigint;
  fromAccountId: string;
  toAccountId: string;
};

type Movement = { medium: 'balance'; amount: number; transaction_date: string; status: 'completed'; description: string };
type Recorded = { _id: string; description?: string };

/**
 * Nessie's live API can't name a recipient on a transfer, so a settlement is two
 * documented calls: a withdrawal from the payer's account and a deposit into the
 * payee's, linked by a tag in both descriptions.
 */
export interface MoneyGateway {
  withdraw(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  deposit(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  listWithdrawals(accountId: string): Promise<Recorded[]>;
  listDeposits(accountId: string): Promise<Recorded[]>;
}

export type Outcome = { withdrawalId?: string; depositId?: string; error?: string };

export interface TransferStore {
  update(transferId: string, status: 'submitted' | 'done' | 'failed', outcome?: Outcome): Promise<void>;
}

/** Both Nessie records carry this tag, so a restart can find them again. */
export function transferTag(transferId: string): string {
  return `[tab:${transferId}]`;
}

function createdId(result: CreationResult<{ _id: string }>, what: string): string {
  const id = typeof result !== 'string' ? result.objectCreated?._id : undefined;
  if (!id) throw new Error(`Nessie acknowledged the ${what} without returning its id`);
  return id;
}

function describe(err: unknown): string {
  const body = (err as { body?: unknown }).body;
  const message = err instanceof Error ? err.message : String(err);
  return body ? `${message} ${typeof body === 'string' ? body : JSON.stringify(body)}` : message;
}

/**
 * Moves one transfer through Nessie (SPEC 12.2). It's marked `submitted` before
 * Nessie is called, and each leg is looked up by its tag before it's created,
 * so a worker that stopped mid-flight never withdraws or deposits twice.
 * SpacetimeDB keeps the exact amount; Nessie gets whole dollars plus the exact
 * amount in each description.
 */
export async function executeTransfer(
  item: WorkItem,
  gateway: MoneyGateway,
  store: TransferStore,
  options: { today?: string } = {},
): Promise<'done' | 'failed'> {
  const tag = transferTag(item.transferId);
  const dollars = (Number(item.amountCents) / 100).toFixed(2);
  // Nessie only takes whole dollars (deposits reject anything else), so both legs
  // record the nearest dollar, at least $1, and the description keeps the cents.
  const wholeDollars = Math.max(1, Math.round(Number(item.amountCents) / 100));
  const movement = (description: string): Movement => ({
    medium: 'balance',
    amount: wholeDollars,
    transaction_date: options.today ?? new Date().toISOString().slice(0, 10),
    status: 'completed',
    description: `${description} $${dollars} ${tag}`,
  });
  const outcome: Outcome = {};
  try {
    if (item.status === 'pending') await store.update(item.transferId, 'submitted');

    outcome.withdrawalId = (await gateway.listWithdrawals(item.fromAccountId)).find(r => r.description?.includes(tag))?._id
      ?? createdId(await gateway.withdraw(item.fromAccountId, movement('Tab settlement sent')), 'withdrawal');
    outcome.depositId = (await gateway.listDeposits(item.toAccountId)).find(r => r.description?.includes(tag))?._id
      ?? createdId(await gateway.deposit(item.toAccountId, movement('Tab settlement received')), 'deposit');

    await store.update(item.transferId, 'done', outcome);
    return 'done';
  } catch (err) {
    const leg = outcome.withdrawalId ? 'deposit' : 'withdrawal';
    await store.update(item.transferId, 'failed', { ...outcome, error: `${leg} failed: ${describe(err)}` });
    return 'failed';
  }
}
