import { describe, expect, it } from 'vitest';
import { computeSplit, type SplitInput } from '../src/split-math';

const people = (...phones: string[]) => phones.map(phone => ({ phone }));
const objectify = (result: Map<string, bigint>) => Object.fromEntries(result);
const split = (input: SplitInput) => objectify(computeSplit(input));

describe('SPEC section 8 split vectors', () => {
  it('splits divisible totals evenly', () => {
    expect(split({ mode: 'even', participants: people('A', 'B', 'C', 'D'), subtotalCents: 6300n }))
      .toEqual({ A: 1575n, B: 1575n, C: 1575n, D: 1575n });
  });

  it('gives an even remainder to the lowest phone', () => {
    expect(split({ mode: 'even', participants: people('A', 'B', 'C'), subtotalCents: 10000n }))
      .toEqual({ A: 3334n, B: 3333n, C: 3333n });
  });

  it('allocates tax and tip proportionally', () => {
    expect(split({
      mode: 'itemized', participants: people('A', 'B', 'C'), subtotalCents: 8000n,
      taxCents: 600n, tipCents: 1600n,
      items: [
        { amountCents: 3000n, claimers: ['A'] },
        { amountCents: 2000n, claimers: ['B'] },
        { amountCents: 3000n, claimers: ['C'] },
      ],
    })).toEqual({ A: 3825n, B: 2550n, C: 3825n });
  });

  it('rounds by largest fractional remainder', () => {
    expect(split({
      mode: 'itemized', participants: people('A', 'B', 'C'), subtotalCents: 1000n, taxCents: 100n,
      items: [
        { amountCents: 333n, claimers: ['A'] },
        { amountCents: 333n, claimers: ['B'] },
        { amountCents: 334n, claimers: ['C'] },
      ],
    })).toEqual({ A: 366n, B: 366n, C: 368n });
  });

  it('splits a shared item', () => {
    expect(split({
      mode: 'itemized', participants: people('A', 'B'), subtotalCents: 800n,
      items: [{ amountCents: 800n, claimers: ['A', 'B'] }],
    })).toEqual({ A: 400n, B: 400n });
  });

  it('honors a custom fixed share', () => {
    expect(split({
      mode: 'custom',
      participants: [{ phone: 'John', fixedCents: 300n }, ...people('A', 'B', 'C')],
      subtotalCents: 4800n,
    })).toEqual({ John: 300n, A: 1500n, B: 1500n, C: 1500n });
  });

  it('splits the unclaimed pool among everyone', () => {
    expect(split({
      mode: 'itemized', participants: people('A', 'B', 'C'), subtotalCents: 6000n,
      items: [
        { amountCents: 2000n, claimers: ['A'] },
        { amountCents: 1000n, claimers: ['B'] },
        { amountCents: 3000n, claimers: [] },
      ],
    })).toEqual({ A: 3000n, B: 2000n, C: 1000n });
  });

  it('applies a discount proportionally', () => {
    expect(split({
      mode: 'itemized', participants: people('A', 'B'), subtotalCents: 5000n,
      taxCents: 400n, discountCents: 500n,
      items: [
        { amountCents: 2500n, claimers: ['A'] },
        { amountCents: 2500n, claimers: ['B'] },
      ],
    })).toEqual({ A: 2450n, B: 2450n });
  });
});

describe('split validation and edge cases', () => {
  it('splits a zero subtotal total evenly', () => {
    expect(split({ mode: 'even', participants: people('A', 'B'), subtotalCents: 0n, feesCents: 5n }))
      .toEqual({ A: 3n, B: 2n });
  });

  it('excludes opted-out members', () => {
    expect(split({
      mode: 'even', participants: [{ phone: 'A' }, { phone: 'B', optedOut: true }], subtotalCents: 500n,
    })).toEqual({ A: 500n });
  });

  it('rejects excessive fixed amounts', () => {
    expect(() => split({
      mode: 'custom', participants: [{ phone: 'A', fixedCents: 501n }], subtotalCents: 500n,
    })).toThrow('exceed');
  });

  it('rejects negative totals', () => {
    expect(() => split({
      mode: 'even', participants: people('A'), subtotalCents: 100n, discountCents: 101n,
    })).toThrow('total');
  });
});
