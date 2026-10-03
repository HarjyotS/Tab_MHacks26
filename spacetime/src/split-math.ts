export type SplitParticipant = {
  phone: string;
  fixedCents?: bigint;
  optedOut?: boolean;
};

export type SplitItem = {
  amountCents: bigint;
  claimers: string[];
};

export type SplitInput = {
  mode: 'even' | 'custom' | 'itemized';
  participants: SplitParticipant[];
  subtotalCents: bigint;
  taxCents?: bigint;
  tipCents?: bigint;
  feesCents?: bigint;
  discountCents?: bigint;
  items?: SplitItem[];
};

type Fraction = { numerator: bigint; denominator: bigint };

const fraction = (numerator = 0n, denominator = 1n): Fraction => {
  if (denominator <= 0n) throw new Error('Fraction denominator must be positive');
  return { numerator, denominator };
};

const add = (left: Fraction, right: Fraction): Fraction =>
  fraction(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator
  );

function assertNonNegative(label: string, value: bigint): void {
  if (value < 0n) throw new Error(`${label} cannot be negative`);
}

export function computeSplit(input: SplitInput): Map<string, bigint> {
  const participants = input.participants
    .filter(participant => !participant.optedOut)
    .sort((a, b) => a.phone.localeCompare(b.phone));
  if (participants.length === 0) throw new Error('An expense needs a participant');

  const phones = new Set(participants.map(participant => participant.phone));
  if (phones.size !== participants.length) throw new Error('Duplicate participant');

  const subtotal = input.subtotalCents;
  const tax = input.taxCents ?? 0n;
  const tip = input.tipCents ?? 0n;
  const fees = input.feesCents ?? 0n;
  const discount = input.discountCents ?? 0n;
  for (const [label, value] of [
    ['subtotal', subtotal],
    ['tax', tax],
    ['tip', tip],
    ['fees', fees],
    ['discount', discount],
  ] as const) assertNonNegative(label, value);

  const total = subtotal + tax + tip + fees - discount;
  if (total < 0n) throw new Error('Expense total cannot be negative');

  const bases = new Map<string, Fraction>(
    participants.map(participant => [participant.phone, fraction()])
  );
  const participantCount = BigInt(participants.length);

  if (subtotal === 0n) {
    return roundFractions(
      participants.map(participant => ({
        phone: participant.phone,
        raw: fraction(total, participantCount),
      })),
      total
    );
  }

  if (input.mode === 'even') {
    for (const participant of participants) {
      bases.set(participant.phone, fraction(subtotal, participantCount));
    }
  } else if (input.mode === 'custom') {
    const fixed = participants.filter(participant => participant.fixedCents !== undefined);
    const flexible = participants.filter(participant => participant.fixedCents === undefined);
    const fixedTotal = fixed.reduce((sum, participant) => {
      assertNonNegative('fixed amount', participant.fixedCents!);
      return sum + participant.fixedCents!;
    }, 0n);
    if (fixedTotal > subtotal) throw new Error('Fixed amounts exceed subtotal');
    const remainder = subtotal - fixedTotal;
    if (flexible.length === 0 && remainder !== 0n) {
      throw new Error('Custom split does not allocate the full subtotal');
    }
    for (const participant of fixed) {
      bases.set(participant.phone, fraction(participant.fixedCents!));
    }
    for (const participant of flexible) {
      bases.set(participant.phone, fraction(remainder, BigInt(flexible.length)));
    }
  } else {
    const items = input.items ?? [];
    const itemTotal = items.reduce((sum, item) => {
      assertNonNegative('item amount', item.amountCents);
      return sum + item.amountCents;
    }, 0n);
    if (itemTotal !== subtotal) throw new Error('Line items must sum to subtotal');

    let unclaimed = 0n;
    for (const item of items) {
      const claimers = [...new Set(item.claimers)].sort();
      for (const claimer of claimers) {
        if (!phones.has(claimer)) throw new Error(`Unknown or opted-out claimer: ${claimer}`);
      }
      if (claimers.length === 0) {
        unclaimed += item.amountCents;
        continue;
      }
      const portion = fraction(item.amountCents, BigInt(claimers.length));
      for (const claimer of claimers) bases.set(claimer, add(bases.get(claimer)!, portion));
    }
    if (unclaimed > 0n) {
      const portion = fraction(unclaimed, participantCount);
      for (const participant of participants) {
        bases.set(participant.phone, add(bases.get(participant.phone)!, portion));
      }
    }
  }

  const baseTotal = [...bases.values()].reduce(
    (sum, value) => add(sum, value),
    fraction()
  );
  if (baseTotal.numerator !== subtotal * baseTotal.denominator) {
    throw new Error('Pre-tax allocations do not sum to subtotal');
  }

  return roundFractions(
    participants.map(participant => {
      const base = bases.get(participant.phone)!;
      return {
        phone: participant.phone,
        raw: fraction(base.numerator * total, base.denominator * subtotal),
      };
    }),
    total
  );
}

function roundFractions(
  values: { phone: string; raw: Fraction }[],
  expectedTotal: bigint
): Map<string, bigint> {
  const rounded = values.map(({ phone, raw }) => ({
    phone,
    amount: raw.numerator / raw.denominator,
    remainder: raw.numerator % raw.denominator,
    denominator: raw.denominator,
  }));
  let remaining = expectedTotal - rounded.reduce((sum, value) => sum + value.amount, 0n);
  if (remaining < 0n || remaining > BigInt(rounded.length)) {
    throw new Error('Invalid rounding remainder');
  }

  rounded.sort((a, b) => {
    const left = a.remainder * b.denominator;
    const right = b.remainder * a.denominator;
    if (left === right) return a.phone.localeCompare(b.phone);
    return left > right ? -1 : 1;
  });
  for (let index = 0; index < rounded.length && remaining > 0n; index += 1) {
    rounded[index].amount += 1n;
    remaining -= 1n;
  }

  const result = new Map(rounded.map(value => [value.phone, value.amount]));
  const actualTotal = [...result.values()].reduce((sum, amount) => sum + amount, 0n);
  if (actualTotal !== expectedTotal) throw new Error('Split does not sum to total');
  return result;
}
