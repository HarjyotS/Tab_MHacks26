import { TAB } from "./prompt.js";

type Member = { phone: string; name?: string };

const SELF = new Set(["me", "i", "myself", "my", "sender"]);

// SPEC §9.1 "map every name to a member", done in code so the model can
// never invent a phone. Returns null when the name is not clearly one member.
// Tab is never a person who can pay or owe.
export function resolveName(
  name: string,
  members: Member[],
  sender: string,
): string | null {
  const n = name.trim().toLowerCase().replace(/^@/, "");
  if (!n) return null;
  if (SELF.has(n)) return sender;
  const named = members.filter(
    (m): m is Member & { name: string } => Boolean(m.name) && m.phone !== TAB,
  );
  const exact = named.filter((m) => m.name.toLowerCase() === n);
  if (exact.length === 1) return exact[0]!.phone;
  // Nicknames like "Harj" for Harjyot: a unique prefix of at least 3 letters.
  if (n.length >= 3) {
    const prefix = named.filter((m) => m.name.toLowerCase().startsWith(n));
    if (prefix.length === 1) return prefix[0]!.phone;
  }
  return null;
}
