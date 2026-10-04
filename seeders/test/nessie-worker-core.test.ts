import { describe, expect, it, vi } from 'vitest';
import {
  mirrorTransfer, nessieBalanceCents, plannedDollars, retryDelayMs, transferTag, type MirrorItem, type MoneyGateway,
} from '../src/nessie-worker-core.js';

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
    expect(await mirrorTransfer(item, api, { today: '2026-10-03' })).toMatchObject({ withdrawalId: 'w-1', depositId: 'd-1', created: 2 });
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
    expect(await mirrorTransfer(item, api)).toMatchObject({ withdrawalId: 'w-earlier', depositId: 'd-1', created: 1 });
    expect(api.withdraw).not.toHaveBeenCalled();
  });

  it('records nothing when both legs already exist', async () => {
    const api = gateway({
      withdrawals: [{ _id: 'w-earlier', description: tag }],
      deposits: [{ _id: 'other', description: transferTag('transfer-2') }, { _id: 'd-earlier', description: tag }],
    });
    expect(await mirrorTransfer(item, api)).toMatchObject({ withdrawalId: 'w-earlier', depositId: 'd-earlier', created: 0 });
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

describe('whole dollars with a carried remainder', () => {
  const settle = (n: number, cents: bigint, from = 'acct-kian', to = 'acct-joe'): MirrorItem =>
    ({ transferId: `t-${n}`, amountCents: cents, fromAccountId: from, toAccountId: to });

  it('keeps each account within 50 cents of the exact total over many small settlements', () => {
    const done: MirrorItem[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 40; n++) {
      const item = settle(n, BigInt(Math.floor(rand() * 2000) + 1), n % 3 ? 'acct-kian' : 'acct-priya', n % 2 ? 'acct-joe' : 'acct-jake');
      const d = plannedDollars(item, done);
      done.push({ ...item, mirrorStatus: 'recorded', withdrawnDollars: BigInt(d.withdraw), depositedDollars: BigInt(d.deposit) });
    }
    for (const acct of ['acct-kian', 'acct-priya']) {
      const mine = done.filter(r => r.fromAccountId === acct);
      const exact = mine.reduce((s, r) => s + r.amountCents, 0n);
      const dollars = mine.reduce((s, r) => s + r.withdrawnDollars!, 0n);
      expect(Math.abs(Number(dollars * 100n - exact))).toBeLessThanOrEqual(50);
    }
    for (const acct of ['acct-joe', 'acct-jake']) {
      const mine = done.filter(r => r.toAccountId === acct);
      const exact = mine.reduce((s, r) => s + r.amountCents, 0n);
      const dollars = mine.reduce((s, r) => s + r.depositedDollars!, 0n);
      expect(Math.abs(Number(dollars * 100n - exact))).toBeLessThanOrEqual(50);
    }
  });

  it('records two $0.40 settlements as $0 then $1, never a phantom dollar', async () => {
    const first = settle(1, 40n);
    expect(plannedDollars(first, [])).toEqual({ withdraw: 0, deposit: 0 });
    const api = gateway();
    expect(await mirrorTransfer(first, api, { dollars: plannedDollars(first, []) })).toMatchObject({ created: 0 });
    expect(api.withdraw).not.toHaveBeenCalled();
    const done = [{ ...first, mirrorStatus: 'recorded', withdrawnDollars: 0n, depositedDollars: 0n }];
    expect(plannedDollars(settle(2, 40n), done)).toEqual({ withdraw: 1, deposit: 1 });
  });

  it('ignores failed or unrecorded rows when carrying', () => {
    const failed = { ...settle(1, 9000n), mirrorStatus: 'failed', withdrawnDollars: 0n, depositedDollars: 0n };
    expect(plannedDollars(settle(2, 1000n), [failed])).toEqual({ withdraw: 10, deposit: 10 });
  });

  it('keeps the dollars of a leg Nessie already has (a crash before progress was saved)', async () => {
    const api = gateway({ withdrawals: [{ _id: 'w-earlier', amount: 37, description: tag }] });
    expect(await mirrorTransfer(item, api, { dollars: { withdraw: 38, deposit: 38 } })).toMatchObject({
      withdrawalId: 'w-earlier', created: 1, dollars: { withdraw: 37, deposit: 38 },
    });
  });
});

describe('balances from Nessie records', () => {
  it('is the opening balance plus completed deposits minus completed withdrawals', () => {
    const rows = (...xs: [number, string][]) => xs.map(([amount, status], i) => ({ _id: `${i}`, amount, status }));
    // A seeded account: opened at $0, then the $500 starting deposit; one pending deposit doesn't count yet.
    expect(nessieBalanceCents(0, rows([500, 'completed'], [20, 'pending'], [38, 'completed']), rows([12, 'completed']))).toBe(52600n);
    expect(nessieBalanceCents(500, [], [])).toBe(50000n);
  });
});

describe('retries', () => {
  it('backs off 2s, 8s, 32s, then caps at 2 minutes', () => {
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([2_000, 8_000, 32_000, 120_000, 120_000]);
  });
});
