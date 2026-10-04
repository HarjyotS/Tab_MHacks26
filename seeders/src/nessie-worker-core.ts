import type { CreationResult } from 'nessie-node-sdk';

export type MirrorItem = {
  transferId: string;
  amountCents: bigint;
  fromAccountId: string;
  toAccountId: string;
  fromMemberId?: string;
  toMemberId?: string;
  // What nessie_mirror_progress says was already recorded (absent before the first try).
  mirrorStatus?: string;
  withdrawnDollars?: bigint;
  depositedDollars?: bigint;
  attempts?: number;
};

type Movement = { medium: 'balance'; amount: number; transaction_date: string; status: 'completed'; description: string };
type Recorded = { _id: string; description?: string; amount?: number; status?: string };

/**
 * Nessie's API can't name a recipient on a transfer (its transfer schema has no
 * payee), so a settlement is recorded as two documented calls: a withdrawal from
 * the payer's account and a deposit into the payee's, linked by a tag in both
 * descriptions.
 */
export interface MoneyGateway {
  withdraw(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  deposit(accountId: string, input: Movement): Promise<CreationResult<{ _id: string }>>;
  listWithdrawals(accountId: string): Promise<Recorded[]>;
  listDeposits(accountId: string): Promise<Recorded[]>;
}

export type Dollars = { withdraw: number; deposit: number };
export type MirrorResult = { withdrawalId?: string; depositId?: string; created: number; dollars: Dollars };

/** Both Nessie records carry this tag, so the mirror can always find them again. */
export function transferTag(transferId: string): string {
  return `[tab:${transferId}]`;
}

function createdId(result: CreationResult<{ _id: string }>, what: string): string {
  const id = typeof result !== 'string' ? result.objectCreated?._id : undefined;
  if (!id) throw new Error(`Nessie acknowledged the ${what} without returning its id`);
  return id;
}

const roundDollars = (cents: bigint) => Number((cents + 50n) / 100n); // half up, cents ≥ 0

/**
 * Whole dollars for each leg of `item`, carrying the remainder per account
 * (Nessie stores whole dollars). Each account's recorded dollars so far are
 * compared with its exact cents so far, plus this transfer, so the running
 * total in Nessie stays within 50 cents of SpacetimeDB however many small
 * settlements there are. A leg can be $0 (it's then not recorded).
 */
export function plannedDollars(item: MirrorItem, recorded: MirrorItem[]): Dollars {
  const done = recorded.filter(r => r.mirrorStatus === 'recorded' && r.transferId !== item.transferId);
  const carry = (pick: (r: MirrorItem) => boolean, dollars: (r: MirrorItem) => bigint) => {
    const mine = done.filter(pick);
    const cents = mine.reduce((sum, r) => sum + r.amountCents, 0n) + item.amountCents;
    const already = mine.reduce((sum, r) => sum + dollars(r), 0n);
    return Math.max(0, roundDollars(cents) - Number(already));
  };
  return {
    withdraw: carry(r => r.fromAccountId === item.fromAccountId, r => r.withdrawnDollars ?? 0n),
    deposit: carry(r => r.toAccountId === item.toAccountId, r => r.depositedDollars ?? 0n),
  };
}

/**
 * Copies one completed settlement into Nessie (SPEC 12.2). Settlement already
 * happened in SpacetimeDB; this only records it. Each leg is looked up by its tag
 * before it's created, so reruns and restarts never record a payment twice. The
 * description keeps the exact amount; `dollars` comes from plannedDollars.
 */
export async function mirrorTransfer(
  item: MirrorItem,
  gateway: MoneyGateway,
  options: { today?: string; dollars?: Dollars } = {},
): Promise<MirrorResult> {
  const tag = transferTag(item.transferId);
  const exact = (Number(item.amountCents) / 100).toFixed(2);
  const fallback = Math.max(1, Math.round(Number(item.amountCents) / 100));
  const dollars = options.dollars ?? { withdraw: fallback, deposit: fallback };
  const movement = (description: string, amount: number): Movement => ({
    medium: 'balance',
    amount,
    transaction_date: options.today ?? new Date().toISOString().slice(0, 10),
    status: 'completed',
    description: `${description} $${exact} ${tag}`,
  });
  let created = 0;
  const find = async (list: Promise<Recorded[]>) => (await list).find(r => r.description?.includes(tag));
  // A leg already in Nessie (a crash before progress was saved) keeps the dollars it was recorded with.
  const recorded: Dollars = { ...dollars };

  const withdrawal = await find(gateway.listWithdrawals(item.fromAccountId));
  let withdrawalId = withdrawal?._id;
  if (withdrawal) recorded.withdraw = withdrawal.amount ?? dollars.withdraw;
  else if (dollars.withdraw > 0) {
    withdrawalId = createdId(await gateway.withdraw(item.fromAccountId, movement('Tab settlement sent', dollars.withdraw)), 'withdrawal');
    created++;
  }
  const deposit = await find(gateway.listDeposits(item.toAccountId));
  let depositId = deposit?._id;
  if (deposit) recorded.deposit = deposit.amount ?? dollars.deposit;
  else if (dollars.deposit > 0) {
    depositId = createdId(await gateway.deposit(item.toAccountId, movement('Tab settlement received', dollars.deposit)), 'deposit');
    created++;
  }
  return { withdrawalId, depositId, created, dollars: recorded };
}

/**
 * A member's balance as Nessie's records show it. Nessie's sandbox never
 * changes an account's own `balance` after it's opened (deposits, withdrawals,
 * transfers and updates all leave it), so the real balance is the opening
 * balance plus completed deposits minus completed withdrawals.
 */
export function nessieBalanceCents(openingDollars: number, deposits: Recorded[], withdrawals: Recorded[]): bigint {
  const sum = (rows: Recorded[]) => rows.filter(r => r.status === 'completed').reduce((s, r) => s + (r.amount ?? 0), 0);
  return BigInt(Math.round((openingDollars + sum(deposits) - sum(withdrawals)) * 100));
}

/** Retries back off (2s, 8s, 32s, 2 min); after MAX_ATTEMPTS the row stays `failed` until the mirror restarts. */
export const MAX_ATTEMPTS = 5;
export const retryDelayMs = (attempts: number) => Math.min(2_000 * 4 ** Math.max(0, attempts - 1), 120_000);
