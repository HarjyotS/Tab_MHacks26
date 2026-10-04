// Builds the SPEC §6.3 input (shared by the gate and extraction) for a message.
import type { ClassifyInput } from "@tab/gate";
import type { Message } from "../store/types.js";
import {
  activeMembers,
  chatOf,
  recentContext,
  type BrainCtx,
} from "./context.js";

const OPEN = new Set(["needs_info", "proposed", "itemizing", "finalized"]);
const DONE_SHARE = new Set(["paid", "opted_out"]);

function senderGroups(ctx: BrainCtx, m: Message): string[] {
  if (m.group_id) return [m.group_id];
  return ctx.store
    .groups()
    .map((g) => g.group_id)
    .filter((g) =>
      activeMembers(ctx, g).some((x) => x.phone === m.sender_phone),
    );
}

// What is pending for the sender right now, most recent first.
export function openItemsFor(
  ctx: BrainCtx,
  m: Message,
): ClassifyInput["open_items"] {
  const groups = new Set(senderGroups(ctx, m));
  return ctx.store
    .expenses()
    .filter((e) => groups.has(e.group_id) && OPEN.has(e.status))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .flatMap((e) => {
      const share = ctx.store
        .shares(e.expense_id)
        .find((s) => s.phone === m.sender_phone);
      if (share && DONE_SHARE.has(share.status)) return [];
      return [
        {
          expense_id: e.expense_id,
          description: e.description,
          expense_status: e.status,
          my_share_status: share?.status,
        },
      ];
    });
}

export function extractInput(ctx: BrainCtx, m: Message): ClassifyInput {
  const members = senderGroups(ctx, m).flatMap((g) =>
    activeMembers(ctx, g).map((x) => ({ phone: x.phone, name: x.name })),
  );
  const unique = [...new Map(members.map((x) => [x.phone, x])).values()];
  return {
    members: [{ phone: "tab", name: "Tab" }, ...unique],
    context: recentContext(ctx, chatOf(m), m.received_at),
    open_items: openItemsFor(ctx, m),
    message: {
      sender_phone: m.sender_phone,
      is_dm: m.is_dm,
      kind: m.kind,
      text: m.text,
      image_url: m.image_url,
      reply_to_id: m.reply_to_id,
      reply_to_tab: m.reply_to_id
        ? ctx.store.outbox().find((o) => o.sent_photon_id === m.reply_to_id)?.text
        : undefined,
    },
  };
}
