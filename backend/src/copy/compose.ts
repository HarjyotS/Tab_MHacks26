// Assembles the final text for an outbox row: template, optional wit line,
// then Tab's texting style (lowercase, no trailing periods, emoji only if the
// group uses them; style.ts). Enforces the §9.3 group limit.
import type { OutboxPurpose } from "../db/types.js";
import { applyStyle, type GroupStyle } from "./style.js";

// Lists that SPEC shows longer than three lines (item list, balances).
const LIST_PURPOSES = new Set<OutboxPurpose>([
  "item_list",
  "claim_followup",
  "balance_reply",
  "breakdown_reply",
  "settle_request", // ledger mode lists one line per person owed
  "split_proposal", // an uneven split lists one line per person
]);

export const GROUP_MAX_LINES = 3;

// SPEC §7.2: the onboarding intro may run to four short lines.
const maxLines = (purpose: OutboxPurpose) => (purpose === "onboarding_intro" ? 4 : GROUP_MAX_LINES);

export function compose(a: {
  purpose: OutboxPurpose;
  text: string;
  in_group: boolean;
  style: GroupStyle;
  wit?: string | null;
  // Member names, kept the way they were saved when the rest goes lowercase.
  names?: string[];
}): string {
  let text = a.text;
  if (a.wit) {
    const withWit = `${text}\n${a.wit}`;
    const fits =
      !a.in_group ||
      LIST_PURPOSES.has(a.purpose) ||
      withWit.split("\n").length <= maxLines(a.purpose);
    if (fits) text = withWit;
  }
  return applyStyle(text, a.style, a.names);
}

export function fitsGroupLimit(purpose: OutboxPurpose, text: string): boolean {
  return (
    LIST_PURPOSES.has(purpose) || text.split("\n").length <= maxLines(purpose)
  );
}
