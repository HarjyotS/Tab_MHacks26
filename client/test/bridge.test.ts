import { expect, test } from "bun:test";
import { Bridge } from "../src/bridge.ts";
import { ChatDb } from "../src/chatdb.ts";
import { Gate } from "../src/gate.ts";
import { DevHub, HubUnavailable } from "../src/hub.ts";
import { State } from "../src/state.ts";
import { ATTRIBUTED_BODIES, FakeMessages, FakeReplier, FakeSender, FakeTapbacker } from "./helpers.ts";

const A = "+15555550101";
const B = "+15555550102";
const STRANGER = "+15555550199";
const HOUSE = "iMessage;+;chat111";
const PERSONAL = "iMessage;+;chat222";
const HOUR = 3_600_000;

function setup(opts: { threadColumn?: boolean; autoJoin?: boolean } = {}) {
  const fx = new FakeMessages(opts);
  fx.group(HOUSE, [A, B], "the house");
  fx.group(PERSONAL, [A], "family");
  const state = new State(null);
  const gate = new Gate(state, 72 * HOUR);
  const logs: string[] = [];
  const hub = new DevHub(true, (line) => logs.push(line));
  const sender = new FakeSender(fx);
  const tapbacker = new FakeTapbacker(fx);
  const replier = new FakeReplier(fx);
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
      replier,
      autoJoin: opts.autoJoin,
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
  /** Sends the next due row as an inline reply and lets the bridge see it land. */
  async function replyNext() {
    const replied = replier.nextReply();
    const draining = bridge.drainOutbox();
    await replied;
    await bridge.poll();
    await draining;
  }
  return { fx, gate, hub, state, sender, tapbacker, replier, bridge, clock, logs, deliverNext, tapbackNext, replyNext, turnOn };
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

test("sends the group chat's name with group messages so the ledger can title it", async () => {
  const { fx, hub, bridge, gate } = setup();
  const UNNAMED = fx.group("iMessage;+;chat333", [A, B]);
  gate.enable(UNNAMED);
  await bridge.syncRosters();
  fx.message({ chat: HOUSE, fromMe: true, text: "/tab on" });
  await bridge.poll();
  fx.message({ chat: HOUSE, handle: A, text: "got groceries, $63" });
  fx.message({ chat: UNNAMED, handle: B, text: "tickets were $90" });
  await bridge.poll();

  const house = hub.ingested.filter((m) => m.group_id === HOUSE);
  expect(house.map((m) => m.kind)).toEqual(["system", "system", "text"]);
  expect(house.every((m) => m.group_name === "the house")).toBe(true);
  const unnamed = hub.ingested.filter((m) => m.group_id === UNNAMED);
  expect(unnamed.length).toBeGreaterThan(0);
  expect(unnamed.every((m) => !("group_name" in m))).toBe(true);
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

  // Opting out has no window (SPEC 19); a stranger still can't get in.
  fx.message({ chat: fx.dm(A), handle: A, text: "STOP" });
  fx.message({ chat: fx.dm(A), handle: A, text: "delete my data" });
  fx.message({ chat: fx.dm(STRANGER), handle: STRANGER, text: "stop" });
  fx.message({ chat: fx.dm(A), handle: A, text: "stop by later?" });
  await bridge.poll();
  expect(dmText()).toEqual(["@tab what do I owe", "2", "STOP", "delete my data"]);
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

test("replies in thread when the outbox row names the newest message as its target", async () => {
  const { fx, hub, sender, replier, logs, replyNext, turnOn } = setup();
  await turnOn();
  const question = fx.message({ chat: HOUSE, handle: A, text: "who paid for the pizza?" });
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "Joe did, $48.00", target_message_id: question });
  await replyNext();
  expect(replier.calls).toEqual([{ target: question, text: "Joe did, $48.00" }]);
  expect(sender.calls).toHaveLength(0);
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
  expect(logs.some((l) => l.includes("not in"))).toBe(false);
});

test("sends a normal message when the target is no longer the newest", async () => {
  const { fx, hub, sender, replier, deliverNext, turnOn } = setup();
  await turnOn();
  const question = fx.message({ chat: HOUSE, handle: A, text: "who paid?" });
  fx.message({ chat: HOUSE, handle: B, text: "lol" });
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "Joe did", target_message_id: question });
  await deliverNext();
  expect(replier.calls).toHaveLength(0);
  expect(sender.calls).toHaveLength(1);
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
});

test("falls back to a normal message when Messages can't open the reply", async () => {
  const { fx, hub, sender, replier, logs, deliverNext, turnOn } = setup();
  await turnOn();
  const question = fx.message({ chat: HOUSE, handle: A, text: "who paid?" });
  replier.fail = true;
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "Joe did", target_message_id: question });
  await deliverNext();
  expect(replier.calls).toHaveLength(1);
  expect(sender.calls).toHaveLength(1);
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
  expect(logs.some((l) => l.includes("couldn't reply in thread"))).toBe(true);
});

test("tapbacks in a chat with no name, checking its members against Messages' window title", async () => {
  const { fx, hub, tapbacker, bridge, turnOn } = setup();
  await turnOn();
  const dmMessage = fx.message({ chat: fx.dm(A), handle: A, text: "@tab what do I owe" });
  await bridge.poll();
  let fits: ((title: string) => boolean) | undefined;
  const real = tapbacker.react.bind(tapbacker);
  tapbacker.react = async (target, reaction, check) => {
    fits = check;
    return real(target, reaction, check);
  };
  hub.enqueue({ kind: "reaction", to_phone: A, target_message_id: dmMessage, reaction: "like" });
  const reacted = tapbacker.nextReact();
  const draining = bridge.drainOutbox();
  await reacted;
  await bridge.poll();
  await draining;
  expect(tapbacker.calls).toHaveLength(1);
  expect(fits!("+1 (555) 555-0101")).toBe(true);
  expect(fits!("Maybe: Sam Lee")).toBe(true);
  expect(fits!("+1 (555) 555-0102")).toBe(false);
  expect(fits!("the house")).toBe(false);
});

test("sends a normal message when the reply target is in a different chat", async () => {
  const { fx, hub, sender, replier, deliverNext, turnOn } = setup();
  await turnOn();
  const elsewhere = fx.message({ chat: PERSONAL, handle: A, text: "dinner sunday?" });
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "Joe did", target_message_id: elsewhere });
  await deliverNext();
  expect(replier.calls).toHaveLength(0);
  expect(sender.calls).toEqual([{ target: { kind: "group", chatGuid: HOUSE }, content: { text: "Joe did" } }]);
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
});

test("doesn't send twice when the reply script fails after pressing Return", async () => {
  const { fx, hub, sender, replier, logs, replyNext, turnOn } = setup();
  await turnOn();
  const question = fx.message({ chat: HOUSE, handle: A, text: "who paid?" });
  replier.failAfterSending = true;
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "Joe did", target_message_id: question });
  await replyNext();
  expect(sender.calls).toHaveLength(0);
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
  expect(logs.some((l) => l.includes("checking chat.db before resending"))).toBe(true);
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

test("never decodes the owner's own DMs unless Tab is waiting for a send to that person", async () => {
  const { fx, bridge, hub, turnOn } = setup();
  await turnOn();
  const before = hub.ingested.length;
  // A personal DM typed from the owner's phone: from-me, no pending send. It must be skipped untouched.
  fx.message({ chat: fx.dm(A), handle: A, fromMe: true, text: null, attributedBody: new Uint8Array([0xff, 0x00, 0x13]) });
  await bridge.poll();
  expect(hub.ingested).toHaveLength(before);
});

test("keeps a message while the backend is down, however long that takes", async () => {
  const { fx, hub, bridge, clock, turnOn } = setup();
  await turnOn();
  const real = hub.ingest.bind(hub);
  let down = true;
  hub.ingest = async (m) => {
    if (down) throw new HubUnavailable("backend unreachable");
    return real(m);
  };
  const before = hub.ingested.length;
  fx.message({ chat: HOUSE, handle: A, text: "i paid 40 for gas" });
  await bridge.poll();
  clock.offset += 10 * 60_000; // well past attachmentWaitMs
  await bridge.poll();
  expect(hub.ingested).toHaveLength(before);

  down = false;
  await bridge.poll();
  expect(hub.ingested.slice(before).map((m) => m.text)).toEqual(["i paid 40 for gas"]);
});

test("a send the hub couldn't hear about is kept and told once it's back", async () => {
  const { fx, hub, state, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  fx.message({ chat: HOUSE, handle: A, text: "@tab ping" });
  await bridge.poll();
  const [pong] = hub.dueOutbox(new Date(8.64e15));
  const real = hub.markOutbox.bind(hub);
  let down = true;
  hub.markOutbox = async (id, update) => {
    if (down && update.status !== "sending") throw new HubUnavailable("backend restarting");
    return real(id, update);
  };
  await deliverNext();
  expect(hub.row(pong!.action_id)?.status).toBe("sending");
  const kept = state.data.pendingMarks[pong!.action_id];
  expect(kept).toMatchObject({ status: "sent" });
  expect(kept!.sent_photon_id).toBeString();

  await bridge.drainOutbox(); // still down: nothing else goes out either
  expect(state.data.pendingMarks[pong!.action_id]).toBeDefined();
  down = false;
  await bridge.drainOutbox();
  expect(hub.row(pong!.action_id)).toMatchObject({ status: "sent", sent_photon_id: kept!.sent_photon_id });
  expect(state.data.pendingMarks).toEqual({});
});

test("a row marked sending while the hub looked down, but never sent, still goes out", async () => {
  const { fx, hub, sender, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  fx.message({ chat: HOUSE, handle: A, text: "@tab ping" });
  await bridge.poll();
  const [pong] = hub.dueOutbox(new Date(8.64e15));
  const real = hub.markOutbox.bind(hub);
  let flaky = true;
  // The mark lands, but the answer never comes back (a timeout).
  hub.markOutbox = async (id, update) => {
    await real(id, update);
    if (flaky && update.status === "sending") throw new HubUnavailable("timed out");
  };
  expect(bridge.drainOutbox()).rejects.toBeInstanceOf(HubUnavailable);
  await Bun.sleep(0);
  expect(hub.row(pong!.action_id)?.status).toBe("sending");
  expect(sender.sentGuids).toHaveLength(0);

  flaky = false;
  await deliverNext();
  expect(hub.row(pong!.action_id)?.status).toBe("sent");
  expect(sender.sentGuids).toHaveLength(1);
});

test("a Tab with no number sends a contact card with its Apple Account email", async () => {
  const fx = new FakeMessages();
  fx.group(HOUSE, [A, B], "the house");
  const state = new State(null);
  const gate = new Gate(state, 72 * HOUR);
  const hub = new DevHub(false, () => {});
  const sender = new FakeSender(fx);
  const bridge = new Bridge(new ChatDb(fx.path), hub, sender, null, { publish: async (p) => p }, gate, state, {
    commandPrefix: "/tab", tabName: "Tab", tabEmail: "tab@addtab.app", sendMatchTimeoutMs: 2_000, tapbackVerifyMs: 300,
    attachmentWaitMs: 60_000, chatWaitMs: 10_000, now: Date.now, log: () => {},
  });
  fx.message({ chat: HOUSE, fromMe: true, text: "/tab on" });
  await bridge.poll();
  const row = hub.enqueue({ kind: "contact_card", group_id: HOUSE });
  const sent = sender.nextSend();
  const draining = bridge.drainOutbox();
  await sent;
  await bridge.poll();
  await draining;
  const card = sender.calls[0]!.content;
  expect("file" in card && card.file.data.toString()).toContain("EMAIL;type=INTERNET:tab@addtab.app");
  expect("file" in card && card.file.data.toString()).not.toContain("TEL");
  // Tab's logo, folded into 75-character lines.
  const text = "file" in card ? card.file.data.toString() : "";
  expect(text).toContain("PHOTO;ENCODING=b;TYPE=PNG:iVBORw0KGgo");
  expect(text.split("\r\n").every((line) => line.length <= 75)).toBe(true);
  expect(hub.row(row.action_id)?.status).toBe("sent");
});

test("with AUTO_JOIN, Tab switches itself on in a group it's added to", async () => {
  const { fx, hub, gate, bridge } = setup({ autoJoin: true });
  fx.message({ chat: HOUSE, handle: A, text: "added tab, it does the math" });
  await bridge.poll();
  expect(gate.groupEnabled(HOUSE)).toBe(true);
  expect(hub.ingested.map((m) => [m.kind, m.text, m.sender_phone])).toEqual([
    ["system", "member_joined", A],
    ["system", "member_joined", B],
    ["text", "added tab, it does the math", A],
  ]);
  expect(gate.groupEnabled(PERSONAL)).toBe(false); // only groups with something new
});

test("with AUTO_JOIN, a group switched off stays off until /tab on", async () => {
  const { fx, hub, gate, bridge, turnOn } = setup({ autoJoin: true });
  fx.message({ chat: HOUSE, fromMe: true, text: "/tab off" });
  await bridge.poll();
  fx.message({ chat: HOUSE, handle: A, text: "paid 40 for gas" });
  await bridge.poll();
  expect(gate.groupEnabled(HOUSE)).toBe(false);
  expect(hub.ingested).toHaveLength(0);

  await turnOn();
  expect(gate.groupEnabled(HOUSE)).toBe(true);
  fx.message({ chat: HOUSE, fromMe: true, text: "/tab off" });
  await bridge.poll();
  fx.message({ chat: HOUSE, handle: B, text: "anyone?" });
  await bridge.poll();
  expect(gate.groupEnabled(HOUSE)).toBe(false);
});

test("without AUTO_JOIN, a new group stays off", async () => {
  const { fx, hub, gate, bridge } = setup();
  fx.message({ chat: HOUSE, handle: A, text: "hi" });
  await bridge.poll();
  expect(gate.groupEnabled(HOUSE)).toBe(false);
  expect(hub.ingested).toHaveLength(0);
});

test("a question about a cost that can't be an inline reply quotes the message it's about", async () => {
  const { fx, hub, sender, replier, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  const refund = fx.message({ chat: HOUSE, handle: A, text: "Also got a $16 refund from the hotel for the broken AC unit" });
  fx.message({ chat: HOUSE, handle: B, text: "nice" });
  await bridge.poll();
  const row = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "want me to split that?", target_message_id: refund, purpose: "clarifying_question" });
  await deliverNext();
  expect(replier.calls).toHaveLength(0); // not the newest message: Messages can't thread onto it
  const sent = sender.calls[0]!.content;
  expect("text" in sent && sent.text).toBe('re: "Also got a $16 refund from the hotel…"\nwant me to split that?');
  expect(hub.row(row.action_id)).toMatchObject({ status: "sent" });
});

test("other replies that can't thread go out as they are", async () => {
  const { fx, hub, sender, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  const ask = fx.message({ chat: HOUSE, handle: A, text: "how much do i owe" });
  fx.message({ chat: HOUSE, handle: B, text: "same" });
  await bridge.poll();
  hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "you owe Joe $15.00", target_message_id: ask, purpose: "balance_reply" });
  await deliverNext();
  const sent = sender.calls[0]!.content;
  expect("text" in sent && sent.text).toBe("you owe Joe $15.00");
});

test("a tapback that never lands closes the picker before anything else goes out", async () => {
  const { fx, hub, tapbacker, bridge, turnOn } = setup();
  await turnOn();
  const msg = fx.message({ chat: HOUSE, handle: A, text: "paid 20 for an uber" });
  await bridge.poll();
  tapbacker.noOp = true;
  const row = hub.enqueue({ kind: "reaction", group_id: HOUSE, target_message_id: msg, reaction: "like" });
  await bridge.drainOutbox();
  expect(hub.row(row.action_id)?.error).toContain("never showed up");
  expect(tapbacker.dismissed).toBe(1);
});

test("with imsg, Tab tapbacks and replies to a message that's no longer the newest", async () => {
  const { fx, hub, tapbacker, replier, sender, bridge, deliverNext, turnOn } = setup();
  await turnOn();
  const uber = fx.message({ chat: HOUSE, handle: A, text: "paid 20 for an uber" });
  fx.message({ chat: HOUSE, handle: B, text: "nice" });
  await bridge.poll();
  tapbacker.anyMessage = true;
  replier.anyMessage = true;
  const chats: (string | undefined)[] = [];
  const react = tapbacker.react.bind(tapbacker);
  tapbacker.react = async (t, r, f, chat) => (chats.push(chat), react(t, r, f, chat));

  const like = hub.enqueue({ kind: "reaction", group_id: HOUSE, target_message_id: uber, reaction: "like" });
  const reacted = tapbacker.nextReact();
  const draining = bridge.drainOutbox();
  await reacted;
  await bridge.poll();
  await draining;
  expect(hub.row(like.action_id)?.status).toBe("sent");
  expect(chats).toEqual([HOUSE]);

  const ask = hub.enqueue({ kind: "group_message", group_id: HOUSE, text: "who rode?", target_message_id: uber, purpose: "clarifying_question" });
  const replied = replier.nextReply();
  const draining2 = bridge.drainOutbox();
  await replied;
  await bridge.poll();
  await draining2;
  expect(replier.calls.map((c) => c.text)).toEqual(["who rode?"]); // threaded, no quote needed
  expect(sender.calls).toHaveLength(0);
  expect(hub.row(ask.action_id)?.status).toBe("sent");
});
