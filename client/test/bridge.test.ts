import { expect, test } from "bun:test";
import { Bridge } from "../src/bridge.ts";
import { ChatDb } from "../src/chatdb.ts";
import { Gate } from "../src/gate.ts";
import { DevHub } from "../src/hub.ts";
import { State } from "../src/state.ts";
import { ATTRIBUTED_BODIES, FakeMessages, FakeSender, FakeTapbacker } from "./helpers.ts";

const A = "+15555550101";
const B = "+15555550102";
const STRANGER = "+15555550199";
const HOUSE = "iMessage;+;chat111";
const PERSONAL = "iMessage;+;chat222";
const HOUR = 3_600_000;

function setup(opts: { threadColumn?: boolean } = {}) {
  const fx = new FakeMessages(opts);
  fx.group(HOUSE, [A, B], "the house");
  fx.group(PERSONAL, [A], "family");
  const state = new State(null);
  const gate = new Gate(state, 72 * HOUR);
  const logs: string[] = [];
  const hub = new DevHub(true, (line) => logs.push(line));
  const sender = new FakeSender(fx);
  const tapbacker = new FakeTapbacker(fx);
  const clock = { offset: 0 };
  const bridge = new Bridge(
    new ChatDb(fx.path),
    hub,
    sender,
    tapbacker,
    { publish: async (path) => `https://img.test/${path.split("/").pop()}` },
    gate,
    state,
    {
      commandPrefix: "/tab",
      tabName: "Tab",
      tabPhone: "+15555550100",
      sendMatchTimeoutMs: 2_000,
      tapbackVerifyMs: 300,
      attachmentWaitMs: 60_000,
      chatWaitMs: 10_000,
      now: () => Date.now() + clock.offset,
      log: (line) => logs.push(line),
    },
  );
  /** Sends the next due outbox row and lets the bridge see it land in chat.db. */
  async function deliverNext() {
    const sent = sender.nextSend();
    const draining = bridge.drainOutbox();
    await sent;
    await bridge.poll();
    await draining;
  }
  async function turnOn() {
    fx.message({ chat: HOUSE, fromMe: true, text: "/tab on" });
    await bridge.poll();
  }
  /** Sends the next due tapback and lets the bridge look for it in chat.db. */
  async function tapbackNext() {
    const reacted = tapbacker.nextReact();
    const draining = bridge.drainOutbox();
    await reacted;
    await bridge.poll();
    await draining;
  }
  return { fx, gate, hub, sender, tapbacker, bridge, clock, logs, deliverNext, tapbackNext, turnOn };
}

test("ignores a group until Tab's phone says /tab on, then announces members and ingests", async () => {
  const { fx, hub, gate, bridge, turnOn } = setup();
  fx.message({ chat: HOUSE, handle: A, text: "got groceries, $63" });
  await bridge.poll();
  expect(hub.ingested).toHaveLength(0);

  await turnOn();
  expect(gate.groupEnabled(HOUSE)).toBe(true);
  expect(hub.ingested.map((m) => [m.kind, m.text, m.sender_phone])).toEqual([
    ["system", "member_joined", A],
    ["system", "member_joined", B],
  ]);

  // Body only in attributedBody, as on recent macOS.
  const guid = fx.message({ chat: HOUSE, handle: A, text: null, attributedBody: ATTRIBUTED_BODIES[0] });
  fx.message({ chat: PERSONAL, handle: A, text: "mom's birthday is sunday" });
  await bridge.poll();
  expect(hub.ingested).toHaveLength(3);
  expect(hub.ingested[2]).toMatchObject({
    message_id: guid,
    group_id: HOUSE,
    sender_phone: A,
    is_dm: false,
    kind: "text",
    text: "got groceries, $63",
  });
});

test("records sent_photon_id so a tapback on Tab's message routes back to it", async () => {
  const { fx, hub, sender, bridge, logs, deliverNext, turnOn } = setup();
  await turnOn();
  fx.message({ chat: HOUSE, handle: A, text: "@tab ping" });
  await bridge.poll();
  const [pong] = hub.dueOutbox(new Date(8.64e15));
  expect(pong).toMatchObject({ kind: "group_message", text: "pong" });

  await deliverNext();
  const sentGuid = sender.sentGuids[0]!;
  expect(hub.row(pong!.action_id)).toMatchObject({ status: "sent", sent_photon_id: sentGuid });

  fx.message({ chat: HOUSE, handle: B, text: 'Liked "pong"', associatedType: 2001, associatedGuid: `p:0/${sentGuid}` });
  await bridge.poll();
  expect(hub.ingested.at(-1)).toMatchObject({ kind: "reaction", reaction: "like", reply_to_id: sentGuid, sender_phone: B });
  expect(logs.some((l) => l.includes(`like is on Tab's other "pong"`))).toBe(true);
});

test("removed tapbacks and the owner's own typing are not ingested", async () => {
  const { fx, hub, bridge, turnOn } = setup();
  await turnOn();
  const before = hub.ingested.length;
  fx.message({ chat: HOUSE, handle: B, associatedType: 3001, associatedGuid: "p:0/GUID-1", text: "Removed a like" });
  fx.message({ chat: HOUSE, fromMe: true, text: "typed this on my phone" });
  await bridge.poll();
  expect(hub.ingested).toHaveLength(before);
});

test("DMs: only members, and only replies to Tab or messages addressed to Tab", async () => {
  const { fx, hub, clock, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  const before = hub.ingested.length;
  const dmText = () => hub.ingested.slice(before).map((m) => m.text);

  fx.message({ chat: fx.dm(A), handle: A, text: "yo wanna get lunch" });
  fx.message({ chat: fx.dm(STRANGER), handle: STRANGER, text: "@tab hi" });
  fx.message({ chat: fx.dm(A), handle: A, text: "@tab what do I owe" });
  await bridge.poll();
  expect(dmText()).toEqual(["@tab what do I owe"]);
  expect(hub.ingested.at(-1)).toMatchObject({ is_dm: true, sender_phone: A });
  expect(hub.ingested.at(-1)!.group_id).toBeUndefined();

  hub.enqueue({ kind: "dm", to_phone: A, text: "Reply with numbers, or 'even'." });
  await deliverNext();
  fx.message({ chat: fx.dm(A), handle: A, text: "2" });
  await bridge.poll();
  expect(dmText()).toEqual(["@tab what do I owe", "2"]);

  clock.offset += 73 * HOUR;
  fx.message({ chat: fx.dm(A), handle: A, text: "3" });
  await bridge.poll();
  expect(dmText()).toEqual(["@tab what do I owe", "2"]);
});

test("never posts, DMs, or tapbacks outside enabled groups and their members", async () => {
  const { fx, hub, sender, tapbacker, bridge, turnOn } = setup();
  await turnOn();
  const familyMessage = fx.message({ chat: PERSONAL, handle: A, text: "dinner sunday?" });
  const rows = [
    hub.enqueue({ kind: "group_message", group_id: PERSONAL, text: "hi family" }),
    hub.enqueue({ kind: "dm", to_phone: STRANGER, text: "you owe me" }),
    hub.enqueue({ kind: "reaction", group_id: PERSONAL, target_message_id: familyMessage, reaction: "like" }),
  ];
  await bridge.drainOutbox();
  expect(sender.calls).toHaveLength(0);
  expect(tapbacker.calls).toHaveLength(0);
  expect(rows.map((r) => hub.row(r.action_id)?.status)).toEqual(["failed", "failed", "failed"]);
  expect(hub.row(rows[2]!.action_id)?.error).toContain("refusing to tapback");
});

test("sends a tapback and confirms it landed on the right message", async () => {
  const { fx, hub, tapbacker, bridge, logs, tapbackNext, turnOn } = setup();
  await turnOn();
  const guid = fx.message({ chat: HOUSE, handle: A, text: "@tab like" });
  await bridge.poll();
  const [row] = hub.dueOutbox(new Date(8.64e15));
  expect(row).toMatchObject({ kind: "reaction", target_message_id: guid, reaction: "like" });

  await tapbackNext();
  expect(tapbacker.calls).toEqual([{ target: guid, reaction: "like" }]);
  expect(hub.row(row!.action_id)).toMatchObject({ status: "sent" });
  expect(hub.row(row!.action_id)?.sent_photon_id).toStartWith("GUID-");
  expect(logs.some((l) => l.includes("unrequested"))).toBe(false);
});

test("fails a tapback that lands on the wrong message and logs the stray one", async () => {
  const { fx, hub, tapbacker, bridge, logs, tapbackNext, turnOn } = setup();
  await turnOn();
  const wrong = fx.message({ chat: HOUSE, handle: B, text: "lmao" });
  const right = fx.message({ chat: HOUSE, handle: A, text: "got pizza, $48" });
  await bridge.poll();
  tapbacker.misfireOnto = wrong;
  const row = hub.enqueue({ kind: "reaction", group_id: HOUSE, target_message_id: right, reaction: "like" });

  await tapbackNext();
  expect(hub.row(row.action_id)).toMatchObject({ status: "failed" });
  expect(hub.row(row.action_id)?.error).toContain("never showed up");
  expect(logs.some((l) => l.includes(`unrequested like from Tab's account on ${wrong}`))).toBe(true);
});

test("skips a tapback once a newer message has arrived in the chat", async () => {
  const { fx, hub, tapbacker, bridge, turnOn } = setup();
  await turnOn();
  const target = fx.message({ chat: HOUSE, handle: A, text: "got pizza, $48" });
  fx.message({ chat: HOUSE, handle: B, text: "nice" });
  await bridge.poll();
  const row = hub.enqueue({ kind: "reaction", group_id: HOUSE, target_message_id: target, reaction: "like" });

  await bridge.drainOutbox();
  expect(tapbacker.calls).toHaveLength(0);
  expect(hub.row(row.action_id)).toMatchObject({ status: "failed" });
  expect(hub.row(row.action_id)?.error).toContain("no longer the newest");
});

test("sends the contact card as a vCard", async () => {
  const { hub, sender, deliverNext, turnOn } = setup();
  await turnOn();
  const row = hub.enqueue({ kind: "contact_card", group_id: HOUSE });
  await deliverNext();
  const content = sender.calls[0]!.content;
  expect("file" in content && content.file.name).toBe("Tab.vcf");
  expect("file" in content && content.file.data.toString()).toContain("TEL;type=CELL:+15555550100");
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent", sent_photon_id: sender.sentGuids[0] });
});

test("waits for a receipt photo to finish downloading, then ingests it with its caption", async () => {
  const { fx, hub, bridge, turnOn } = setup({ threadColumn: false });
  await turnOn();
  const before = hub.ingested.length;
  const guid = fx.message({ chat: HOUSE, handle: A, text: "￼dinner", hasAttachments: true });
  const att = fx.attach(guid, "~/Library/Messages/Attachments/ab/IMG_1.HEIC", "image/heic", 3);
  await bridge.poll();
  expect(hub.ingested).toHaveLength(before);

  fx.setTransferState(att, 5);
  await bridge.poll();
  expect(hub.ingested.at(-1)).toMatchObject({
    message_id: guid,
    kind: "image",
    text: "dinner",
    image_url: "https://img.test/IMG_1.HEIC",
  });
});

test("passes threaded replies through as reply_to_id", async () => {
  const { fx, hub, bridge, turnOn } = setup();
  await turnOn();
  fx.message({ chat: HOUSE, handle: A, text: "actually it was 38", threadOriginator: "GUID-PROPOSAL" });
  await bridge.poll();
  expect(hub.ingested.at(-1)).toMatchObject({ kind: "text", reply_to_id: "GUID-PROPOSAL" });
});

test("ingests members joining and leaving, and stops on /tab off", async () => {
  const { fx, hub, gate, bridge, turnOn } = setup();
  await turnOn();
  const C = "+15555550103";
  fx.join(HOUSE, C);
  fx.leave(HOUSE, B);
  await bridge.syncRosters();
  expect(hub.ingested.slice(-2).map((m) => [m.text, m.sender_phone])).toEqual([
    ["member_joined", C],
    ["member_left", B],
  ]);

  fx.message({ chat: HOUSE, fromMe: true, text: "/tab off" });
  fx.message({ chat: HOUSE, handle: A, text: "anyone home?" });
  await bridge.poll();
  expect(gate.groupEnabled(HOUSE)).toBe(false);
  expect(hub.ingested.at(-1)!.text).toBe("member_left");
});

test("READ_DMS=off ignores every DM, even ones addressed to Tab", async () => {
  const fx = new FakeMessages();
  fx.group(HOUSE, [A, B], "the house");
  const state = new State(null);
  const gate = new Gate(state, 72 * HOUR, false);
  const hub = new DevHub(false, () => {});
  const bridge = new Bridge(new ChatDb(fx.path), hub, new FakeSender(fx), null, { publish: async (p) => p }, gate, state, {
    commandPrefix: "/tab", tabName: "Tab", sendMatchTimeoutMs: 500, tapbackVerifyMs: 300,
    attachmentWaitMs: 60_000, chatWaitMs: 10_000, now: Date.now, log: () => {},
  });
  fx.message({ chat: HOUSE, fromMe: true, text: "/tab on" });
  await bridge.poll();
  const before = hub.ingested.length;
  fx.message({ chat: fx.dm(A), handle: A, text: "@tab what do I owe" });
  fx.message({ chat: HOUSE, handle: B, text: "group still works" });
  await bridge.poll();
  expect(hub.ingested.slice(before).map((m) => m.text)).toEqual(["group still works"]);
});
