import type { CreationResult } from 'nessie-node-sdk';

export type SeedMember = {
  memberId: string;
  groupId: string;
  phone: string;
  name?: string;
  customerId?: string;
  accountId?: string;
  depositCreated: boolean;
  seededBalanceCents: bigint;
};

export type SeedProgress = Pick<
  SeedMember,
  'memberId' | 'customerId' | 'accountId' | 'depositCreated' | 'seededBalanceCents'
>;

export interface NessieGateway {
  createCustomer(input: {
    first_name: string;
    last_name: string;
    address: { street_number: string; street_name: string; city: string; state: string; zip: string };
  }): Promise<CreationResult<{ _id: string }>>;
  createAccount(customerId: string, input: {
    type: 'Checking'; nickname: string; rewards: number; balance: number;
  }): Promise<CreationResult<{ _id: string }>>;
  createDeposit(accountId: string, input: {
    medium: string; transaction_date: string; status: string; amount: number; description: string;
  }): Promise<unknown>;
}

export interface ProgressStore {
  save(progress: SeedProgress): Promise<void>;
}

function createdId<T extends { _id: string }>(result: CreationResult<T>, resource: string): string {
  if (typeof result !== 'string' && result.objectCreated?._id) return result.objectCreated._id;
  throw new Error(`Nessie acknowledged ${resource} creation without returning its id`);
}

function splitName(name?: string): [string, string] {
  const parts = (name?.trim() || 'Tab Member').split(/\s+/);
  return [parts[0], parts.slice(1).join(' ') || 'Demo'];
}

export async function provisionMember(
  original: SeedMember,
  gateway: NessieGateway,
  store: ProgressStore,
  options: { forceNew: boolean; startingBalanceCents: bigint; today?: string }
): Promise<SeedMember> {
  if (options.startingBalanceCents < 0n || options.startingBalanceCents % 100n !== 0n) {
    throw new Error('Nessie starting balance must be a non-negative whole-dollar cent amount');
  }
  const member: SeedMember = options.forceNew
    ? { ...original, customerId: undefined, accountId: undefined, depositCreated: false, seededBalanceCents: 0n }
    : { ...original };

  if (!member.customerId) {
    const [first_name, last_name] = splitName(member.name);
    member.customerId = createdId(await gateway.createCustomer({
      first_name,
      last_name,
      address: {
        street_number: '500', street_name: 'S State St', city: 'Ann Arbor', state: 'MI', zip: '48109',
      },
    }), 'customer');
    await store.save(member);
  }

  if (!member.accountId) {
    member.accountId = createdId(await gateway.createAccount(member.customerId, {
      type: 'Checking', nickname: `${member.name ?? 'Tab member'} demo checking`, rewards: 0, balance: 0,
    }), 'account');
    await store.save(member);
  }

  if (!member.depositCreated) {
    await gateway.createDeposit(member.accountId, {
      medium: 'balance', transaction_date: options.today ?? new Date().toISOString().slice(0, 10),
      status: 'completed', amount: Number(options.startingBalanceCents / 100n),
      description: 'Tab demo starting balance',
    });
    member.depositCreated = true;
    member.seededBalanceCents = options.startingBalanceCents;
    await store.save(member);
  }

  return member;
}
