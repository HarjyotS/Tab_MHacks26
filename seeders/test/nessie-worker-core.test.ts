import { describe, expect, it, vi } from 'vitest';
import { mirrorTransfer, transferTag, type MirrorItem, type MoneyGateway } from '../src/nessie-worker-core.js';

const item: MirrorItem = { transferId: 'transfer-1', amountCents: 3825n, fromAccountId: 'acct-kian', toAccountId: 'acct-joe' };
const tag = transferTag('transfer-1');

function gateway(existing: { withdrawals?: object[]; deposits?: object[] } = {}): MoneyGateway {
  return {
    withdraw: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'w-1' } })),
    deposit: vi.fn(async () => ({ code: 201, message: 'ok', objectCreated: { _id: 'd-1' } })),
    listWithdrawals: vi.fn(async () => (existing.withdrawals ?? []) as { _id: string; description?: string }[]),
    listDeposits: vi.fn(async () => (existing.deposits ?? []) as { _id: string; description?: string }[]),
  };
}

describe('Nessie mirror', () => {
  it('records a settlement as a withdrawal from the payer and a deposit to the payee', async () => {
    const api = gateway();
    expect(await mirrorTransfer(item, api, { today: '2026-10-03' })).toEqual({ withdrawalId: 'w-1', depositId: 'd-1', created: 2 });
    expect(api.withdraw).toHaveBeenCalledWith('acct-kian', {
      medium: 'balance', amount: 38, transaction_date: '2026-10-03', status: 'completed',
      description: `Tab settlement sent $38.25 ${tag}`,
    });
    expect(api.deposit).toHaveBeenCalledWith('acct-joe', expect.objectContaining({
      amount: 38, description: `Tab settlement received $38.25 ${tag}`,
    }));
  });

  it('finishes a half-recorded settlement without repeating the withdrawal', async () => {
    const api = gateway({ withdrawals: [{ _id: 'w-earlier', description: `Tab settlement sent $38.25 ${tag}` }] });
    expect(await mirrorTransfer(item, api)).toEqual({ withdrawalId: 'w-earlier', depositId: 'd-1', created: 1 });
    expect(api.withdraw).not.toHaveBeenCalled();
  });

  it('records nothing when both legs already exist', async () => {
    const api = gateway({
      withdrawals: [{ _id: 'w-earlier', description: tag }],
      deposits: [{ _id: 'other', description: transferTag('transfer-2') }, { _id: 'd-earlier', description: tag }],
    });
    expect(await mirrorTransfer(item, api)).toEqual({ withdrawalId: 'w-earlier', depositId: 'd-earlier', created: 0 });
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(api.deposit).not.toHaveBeenCalled();
  });

  it('rounds to whole dollars for Nessie, never below $1', async () => {
    const api = gateway();
    await mirrorTransfer({ ...item, amountCents: 30n }, api);
    expect(api.withdraw).toHaveBeenCalledWith('acct-kian', expect.objectContaining({
      amount: 1, description: `Tab settlement sent $0.30 ${tag}`,
    }));
  });

  it('surfaces a Nessie failure to the caller, which retries later', async () => {
    const api = gateway();
    vi.mocked(api.deposit).mockRejectedValueOnce(new Error('Nessie returned HTTP 503'));
    await expect(mirrorTransfer(item, api)).rejects.toThrow('503');
  });
});
