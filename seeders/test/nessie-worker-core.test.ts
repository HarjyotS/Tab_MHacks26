import { describe, expect, it, vi } from 'vitest';
import { executeTransfer, transferTag, type MoneyGateway, type WorkItem } from '../src/nessie-worker-core.js';

const item: WorkItem = {
  transferId: 'transfer-1', status: 'pending', amountCents: 3825n, fromAccountId: 'acct-kian', toAccountId: 'acct-joe',
};
const tag = transferTag('transfer-1');

function gateway(existing: { withdrawals?: object[]; deposits?: object[] } = {}): MoneyGateway {
  return {
    withdraw: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'w-1' } })),
    deposit: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'd-1' } })),
    listWithdrawals: vi.fn(async () => (existing.withdrawals ?? []) as { _id: string; description?: string }[]),
    listDeposits: vi.fn(async () => (existing.deposits ?? []) as { _id: string; description?: string }[]),
  };
}

function recorder() {
  const updates: unknown[][] = [];
  return { updates, store: { update: async (...args: unknown[]) => { updates.push(args); } } };
}

describe('Nessie settlement worker', () => {
  it('marks submitted first, then withdraws from the payer and deposits to the payee', async () => {
    const api = gateway();
    const { updates, store } = recorder();
    expect(await executeTransfer(item, api, store, { today: '2026-10-03' })).toBe('done');
    expect(updates).toEqual([
      ['transfer-1', 'submitted'],
      ['transfer-1', 'done', { withdrawalId: 'w-1', depositId: 'd-1' }],
    ]);
    expect(api.withdraw).toHaveBeenCalledWith('acct-kian', {
      medium: 'balance', amount: 38, transaction_date: '2026-10-03', status: 'completed',
      description: `Tab settlement sent $38.25 ${tag}`,
    });
    expect(api.deposit).toHaveBeenCalledWith('acct-joe', expect.objectContaining({
      amount: 38, description: `Tab settlement received $38.25 ${tag}`,
    }));
  });

  it('after a restart, reuses the withdrawal Nessie already has and only makes the deposit', async () => {
    const api = gateway({ withdrawals: [{ _id: 'w-earlier', description: `Tab settlement sent $38.25 ${tag}` }] });
    const { updates, store } = recorder();
    expect(await executeTransfer({ ...item, status: 'submitted' }, api, store)).toBe('done');
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(api.deposit).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([['transfer-1', 'done', { withdrawalId: 'w-earlier', depositId: 'd-1' }]]);
  });

  it('never creates either leg twice when both already exist', async () => {
    const api = gateway({
      withdrawals: [{ _id: 'w-earlier', description: tag }],
      deposits: [{ _id: 'other', description: transferTag('transfer-2') }, { _id: 'd-earlier', description: tag }],
    });
    const { updates, store } = recorder();
    await executeTransfer({ ...item, status: 'submitted' }, api, store);
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(api.deposit).not.toHaveBeenCalled();
    expect(updates).toEqual([['transfer-1', 'done', { withdrawalId: 'w-earlier', depositId: 'd-earlier' }]]);
  });

  it('rounds to whole dollars for Nessie, never below $1', async () => {
    const api = gateway();
    await executeTransfer({ ...item, amountCents: 30n }, api, recorder().store);
    expect(api.withdraw).toHaveBeenCalledWith('acct-kian', expect.objectContaining({
      amount: 1, description: `Tab settlement sent $0.30 ${tag}`,
    }));
  });

  it('marks the transfer failed, saying which leg broke and keeping the leg that worked', async () => {
    const api = gateway();
    vi.mocked(api.deposit).mockRejectedValueOnce(Object.assign(new Error('Nessie returned HTTP 400'), { body: 'bad payee' }));
    const { updates, store } = recorder();
    expect(await executeTransfer(item, api, store)).toBe('failed');
    expect(updates.at(-1)).toEqual(['transfer-1', 'failed', {
      withdrawalId: 'w-1', error: 'deposit failed: Nessie returned HTTP 400 bad payee',
    }]);
  });
});
