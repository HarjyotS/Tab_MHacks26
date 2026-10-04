// SPEC §12.3: the web ledger lives at an unguessable /g/<secret> URL, and Tab
// posts it when someone asks ("@tab ledger").
import { createHmac } from "node:crypto";
import * as T from "../copy/templates.js";
import type { Message } from "../store/types.js";
import { type BrainCtx, chatOf, say } from "./context.js";
import { groupsOf } from "./talk.js";

// Derived, not random: the module only lets the backend set a secret, never
// read it back, and setting a new one would break every link already posted.
// The same key and group always give the same secret, across restarts.
export function ledgerSecret(key: string, group_id: string): string {
  return createHmac("sha256", key)
    .update(`ledger:${group_id}`)
    .digest("base64url");
}

// The group's ledger link, making sure the module knows its secret first.
// Undefined when no ledger is configured.
export async function ledgerUrl(
  ctx: BrainCtx,
  group_id: string,
): Promise<string | undefined> {
  if (!ctx.ledger) return undefined;
  const secret = ledgerSecret(ctx.ledger.key, group_id);
  if (!ctx.memory.ledgerSecretSet.has(group_id)) {
    await ctx.db.set_ledger_secret({ group_id, secret });
    ctx.memory.ledgerSecretSet.add(group_id);
  }
  return `${ctx.ledger.baseUrl}/g/${secret}`;
}

// "@tab ledger": the link for this group, or by DM one per group they're in.
export async function handleLedger(ctx: BrainCtx, m: Message) {
  const groups = groupsOf(ctx, m);
  if (groups.length === 0) return;
  const links: { name?: string; url: string }[] = [];
  for (const group_id of groups) {
    const url = await ledgerUrl(ctx, group_id);
    if (url) links.push({ name: ctx.store.group(group_id)?.display_name, url });
  }
  await say(ctx, {
    chat: chatOf(m),
    purpose: "other",
    id: `ledger_link:${m.message_id}`,
    reply_to: m.message_id,
    text: links.length > 0 ? T.ledgerLink(links) : T.noLedger(),
  });
}
