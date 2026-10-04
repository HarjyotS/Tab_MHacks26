// A simulated group chat over the in-memory module: real gate stub, real
// extraction validation over scripted Grok output, real brain. Keeps a
// transcript of everything said, in order, for tests and the sample chat.
import { vi } from "vitest";
import { stubClassifier } from "@tab/gate";
import { timing } from "../../src/config.js";
import { Memory, type BrainCtx } from "../../src/brain/context.js";
import { processMessage, tick } from "../../src/brain/process.js";
import { extractExpense } from "../../src/extraction/expense.js";
import { resolveClaim } from "../../src/extraction/claim.js";
import { extractCorrection } from "../../src/extraction/correction.js";
import type { ReceiptRead } from "../../src/extraction/receipt.js";
import type { ChatClient } from "../../src/grok/structured.js";
import type { Message } from "../../src/store/types.js";
import { MemoryDb } from "./memory-db.js";

export const PEOPLE = {
  Joe: "+15555550101",
  Kian: "+15555550102",
  Priya: "+15555550104",
  Jake: "+15555550105",
} as const;
export type Name = keyof typeof PEOPLE;
const nameOf = (phone: string) =>
  (Object.entries(PEOPLE).find(([, p]) => p === phone)?.[0] ?? phone) as string;

export const GROUP = "house";

const grok = (out: object): ChatClient =>
  ({
    chat: {
      completions: {
        create: vi
          .fn()
          .mockResolvedValue({
            choices: [{ message: { content: JSON.stringify(out) } }],
          }),
      },
    },
  }) as unknown as ChatClient;

export type Script = {
  // "new|text" or "adjustment|text" → raw expense extraction
  expense?: Record<string, object>;
  // claim text → raw claim resolution { kind, item_positions, same_as_name }
  claim?: Record<string, object>;
  // image_url → what Grok vision reads
  receipt?: Record<string, ReceiptRead>;
  // correction text → raw correction extraction
  correction?: Record<string, object>;
};

export function world(
  script: Script,
  start = new Date("2026-10-03T22:00:00Z"),
) {
  let now = start;
  const db = new MemoryDb(() => now);
  db.addGroup(
    GROUP,
    Object.entries(PEOPLE).map(([name, phone]) => ({ phone, name })),
  );
  const transcript: string[] = [];
  let seenOutbox = 0;
  const missing = (what: string, key: string) =>
    new Error(`no scripted ${what} for ${JSON.stringify(key)}`);

  const ctx: BrainCtx = {
    store: db,
    db: db.reducers(),
    now: () => now,
    classify: stubClassifier,
    extract: {
      expense: (input, mode) => {
        const key = `${mode}|${input.message.text}`;
        const out = script.expense?.[key];
        if (!out) throw missing("expense", key);
        return extractExpense(grok(out), "m", input, mode);
      },
      claim: (input, items) => {
        const out = script.claim?.[input.message.text ?? ""];
        if (!out) throw missing("claim", input.message.text ?? "");
        return resolveClaim(grok(out), "m", input, items);
      },
      correction: (input) => {
        const out = script.correction?.[input.message.text ?? ""];
        if (!out) throw missing("correction", input.message.text ?? "");
        return extractCorrection(grok(out), "m", input);
      },
      receipt: async (url) => {
        const read = script.receipt?.[url];
        if (!read) throw missing("receipt", url);
        return read;
      },
    },
    timing: timing({ DEMO_MODE: "true" }),
    memory: new Memory(),
    log: () => {},
  };

  // Record what Tab queued since last time, as the chat would show it.
  function flush() {
    const rows = [...db.out.values()].slice(seenOutbox);
    seenOutbox += rows.length;
    for (const o of rows) {
      if (o.status === "cancelled") continue;
      const where = o.kind === "dm" ? ` → DM to ${nameOf(o.to_phone!)}` : "";
      if (o.kind === "reaction") {
        const target = db.msgs.get(o.target_message_id!);
        const icon = o.reaction === "like" ? "👍" : "❓";
        transcript.push(
          `        Tab reacted ${icon} to ${target ? nameOf(target.sender_phone) : "a message"}${where}`,
        );
      } else if (o.kind === "contact_card") {
        transcript.push(`Tab: [contact card]`);
      } else {
        transcript.push(`Tab${where}: ${o.text!.replace(/\n/g, "\n     ")}`);
      }
    }
    db.deliver();
  }

  const w = {
    db,
    ctx,
    transcript,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    async say(who: Name, text: string, extra: Partial<Message> = {}) {
      w.advance(1000);
      const m = db.ingest({
        sender_phone: PEOPLE[who],
        group_id: extra.is_dm ? undefined : GROUP,
        text,
        ...extra,
      });
      const label =
        extra.kind === "image" ? `[photo]${text ? ` ${text}` : ""}` : text;
      transcript.push(`${who}${extra.is_dm ? " (DM)" : ""}: ${label}`);
      await processMessage(ctx, m);
      flush();
      return db.msgs.get(m.message_id)!;
    },
    async dm(who: Name, text: string) {
      return w.say(who, text, { is_dm: true });
    },
    async photo(who: Name, image_url: string, caption = "") {
      return w.say(who, caption, { kind: "image", image_url });
    },
    async react(
      who: Name,
      action_id: string,
      reaction: Message["reaction"] = "like",
    ) {
      const target = db.out.get(action_id);
      if (!target?.sent_photon_id)
        throw new Error(`no sent message ${action_id}`);
      w.advance(1000);
      const m = db.ingest({
        sender_phone: PEOPLE[who],
        group_id: GROUP,
        kind: "reaction",
        reaction,
        reply_to_id: target.sent_photon_id,
      });
      transcript.push(
        `        ${who} reacted 👍 to Tab's ${target.purpose.replace(/_/g, " ")}`,
      );
      await processMessage(ctx, m);
      flush();
    },
    async wait(ms: number, label?: string) {
      w.advance(ms);
      if (label) transcript.push(`  … ${label}`);
      await tick(ctx);
      flush();
    },
    said: (purpose: string) =>
      db
        .outbox()
        .filter((o) => o.purpose === purpose && o.status !== "cancelled")
        .map((o) => o.text!),
  };
  return w;
}
