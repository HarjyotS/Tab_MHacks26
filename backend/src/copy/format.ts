// Formatting for every number and name Tab sends (SPEC §9.3, P6).

export type Person = { phone: string; name?: string };

export function money(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new RangeError(`cents must be an integer, got ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

// SPEC §7.2: until named, a member is shown by the last four digits.
export function displayName(p: Person): string {
  return p.name ?? `…${p.phone.slice(-4)}`;
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
