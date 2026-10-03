import { describe, expect, it, vi } from 'vitest';
import { provisionMember, type NessieGateway, type SeedMember } from '../src/nessie-core.js';

const base: SeedMember = {
  memberId: 'g:+15550000001', groupId: 'g', phone: '+15550000001', name: 'Kian Test',
  depositCreated: false, seededBalanceCents: 0n,
};

function gateway(): NessieGateway {
  return {
    createCustomer: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'customer-1' } })),
    createAccount: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'account-1' } })),
    createDeposit: vi.fn(async () => ({ code: 201, message: 'ok' })),
  };
}

describe('Nessie provisioning', () => {
  it('persists after each external creation and is idempotent on rerun', async () => {
    const api = gateway();
    const saves: SeedMember[] = [];
    const first = await provisionMember(base, api, { save: async state => { saves.push({ ...base, ...state }); } }, {
      forceNew: false, startingBalanceCents: 50000n, today: '2026-10-03',
    });
    expect(saves).toHaveLength(3);
    expect(first).toMatchObject({ customerId: 'customer-1', accountId: 'account-1', depositCreated: true });

    await provisionMember(first, api, { save: async () => undefined }, {
      forceNew: false, startingBalanceCents: 50000n,
    });
    expect(api.createCustomer).toHaveBeenCalledTimes(1);
    expect(api.createAccount).toHaveBeenCalledTimes(1);
    expect(api.createDeposit).toHaveBeenCalledTimes(1);
  });

  it('resumes after customer creation without duplicating the customer', async () => {
    const api = gateway();
    vi.mocked(api.createAccount).mockRejectedValueOnce(new Error('interrupted'));
    let checkpoint: SeedMember | undefined;
    await expect(provisionMember(base, api, { save: async state => { checkpoint = { ...base, ...state }; } }, {
      forceNew: false, startingBalanceCents: 50000n,
    })).rejects.toThrow('interrupted');
    expect(checkpoint?.customerId).toBe('customer-1');

    await provisionMember(checkpoint!, api, { save: async () => undefined }, {
      forceNew: false, startingBalanceCents: 50000n,
    });
    expect(api.createCustomer).toHaveBeenCalledTimes(1);
    expect(api.createAccount).toHaveBeenCalledTimes(2);
  });

  it('resumes after account creation without duplicating the customer or account', async () => {
    const api = gateway();
    vi.mocked(api.createDeposit).mockRejectedValueOnce(new Error('interrupted'));
    let checkpoint: SeedMember | undefined;
    await expect(provisionMember(base, api, { save: async state => { checkpoint = { ...base, ...state }; } }, {
      forceNew: false, startingBalanceCents: 50000n,
    })).rejects.toThrow('interrupted');
    expect(checkpoint).toMatchObject({ customerId: 'customer-1', accountId: 'account-1', depositCreated: false });

    await provisionMember(checkpoint!, api, { save: async () => undefined }, {
      forceNew: false, startingBalanceCents: 50000n,
    });
    expect(api.createCustomer).toHaveBeenCalledTimes(1);
    expect(api.createAccount).toHaveBeenCalledTimes(1);
    expect(api.createDeposit).toHaveBeenCalledTimes(2);
  });

  it('requires explicit forceNew to replace existing records', async () => {
    const api = gateway();
    const existing = { ...base, customerId: 'old-customer', accountId: 'old-account', depositCreated: true };
    await provisionMember(existing, api, { save: async () => undefined }, {
      forceNew: true, startingBalanceCents: 50000n,
    });
    expect(api.createCustomer).toHaveBeenCalledOnce();
  });
});
