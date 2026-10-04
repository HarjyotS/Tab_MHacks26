import { GROUP_STYLE, type ChatSource, type RawAttachment, type RawMessage } from "./chatdb.ts";
import { appleDate, isAssociated, messageText, normalizeHandle, reactionTarget, tapback } from "./decode.ts";
import { parseCommand, type Gate } from "./gate.ts";
import type { Hub } from "./hub.ts";
import { SentMatcher } from "./matcher.ts";
import type { Outgoing, Sender, Target } from "./sender.ts";
import type { State } from "./state.ts";
import type { Replier } from "./reply.ts";
import type { Tapbacker } from "./tapback.ts";
import type { InboundMessage, OutboxRow } from "./types.ts";

export interface ImagePublisher {
  publish(attachmentPath: string): Promise<string>;
}

export interface BridgeOptions {
  commandPrefix: string;
  tabName: string;
  tabPhone?: string;
  /** How long to wait for a sent message to show up in chat.db. */
  sendMatchTimeoutMs: number;
  /** How long to wait for a tapback to show up on its target in chat.db. */
  tapbackVerifyMs: number;
  /** How long to wait for a photo to finish downloading before giving up on it. */
  attachmentWaitMs: number;
  /** How long to wait for a new row's chat link to be written. */
  chatWaitMs: number;
  now: () => number;
  log: (line: string) => void;
  /** Sends inline (threaded) replies when an outbox row names a target message. */
  replier?: Replier | null;
}

const BATCH = 200;
const MAX_SEND_ATTEMPTS = 3;
const TRANSFER_FINISHED = 5;

type Outcome = "done" | "wait";

/**
 * Turns chat.db rows into `ingest_message` calls and outbox rows into
 * iMessages, following SPEC section 10.
 */
export class Bridge {
  private readonly matcher = new SentMatcher();
  /** Rows waiting on a chat link or a photo download: rowid → first seen. */
  private readonly waiting = new Map<number, number>();
  private highWater = 0;
  private rosterDirty = false;
  private rosterSync: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: ChatSource,
    private readonly hub: Hub,
    private readonly sender: Sender,
    private readonly tapbacker: Tapbacker | null,
    private readonly images: ImagePublisher,
    private readonly gate: Gate,
    private readonly state: State,
    private readonly opts: BridgeOptions,
  ) {
    // On the very first run, start from now rather than replaying history.
    if (state.data.cursor == null) {
      state.data.cursor = db.maxRowId();
      state.save();
    }
    this.highWater = state.data.cursor;
  }

  /** Reads new chat.db rows and ingests the ones Tab is allowed to see. */
  async poll(): Promise<void> {
    const retry = this.db.messagesByRowId([...this.waiting.keys()]);
    for (const rowid of this.waiting.keys()) if (!retry.some((r) => r.rowid === rowid)) this.waiting.delete(rowid);
    for (const row of retry) await this.consider(row);

    for (;;) {
      const rows = this.db.messagesAfter(this.highWater, BATCH);
      for (const row of rows) {
        await this.consider(row);
        this.highWater = row.rowid;
      }
      if (rows.length < BATCH) break;
    }

    // Restart from the oldest unfinished row; re-ingesting is an idempotent upsert.
    const cursor = this.waiting.size ? Math.min(...this.waiting.keys()) - 1 : this.highWater;
    if (cursor !== this.state.data.cursor) {
      this.state.data.cursor = cursor;
      this.state.save();
    }
    if (this.rosterDirty) await this.syncRosters();
  }

  /** Diffs each enabled group's participants and ingests joins and leaves as system messages. */
  syncRosters(): Promise<void> {
    // Queue behind any sync in flight so two never diff against the same old roster.
    this.rosterSync = this.rosterSync.catch(() => {}).then(() => this.diffRosters());
    return this.rosterSync;
  }

  private async diffRosters(): Promise<void> {
    this.rosterDirty = false;
    const groups = this.gate.enabledGroups();
    const current = this.db.participants(groups);
    for (const group of groups) {
      const now = [...new Set((current.get(group) ?? []).map(normalizeHandle))].sort();
      const before = this.gate.roster(group);
      // An empty list mid-write would look like everyone leaving.
      if (now.length === 0) continue;
      const joined = now.filter((h) => !before.includes(h));
      const left = before.filter((h) => !now.includes(h));
      if (joined.length === 0 && left.length === 0) continue;
      const at = new Date(this.opts.now());
      for (const h of joined) await this.hub.ingest(systemMessage(group, h, "member_joined", at));
      for (const h of left) await this.hub.ingest(systemMessage(group, h, "member_left", at));
      this.gate.setRoster(group, now);
    }
  }

  /** Sends every outbox row that is due. */
  async drainOutbox(): Promise<void> {
    for (const row of this.hub.dueOutbox(new Date(this.opts.now()))) await this.deliver(row);
  }

  private async consider(row: RawMessage): Promise<void> {
    const now = this.opts.now();
    const firstSeen = this.waiting.get(row.rowid) ?? now;
    let outcome: Outcome;
    try {
      outcome = await this.handle(row, now - firstSeen);
    } catch (err) {
      const giveUp = now - firstSeen >= this.opts.attachmentWaitMs;
      this.opts.log(`[bridge] row ${row.rowid} failed${giveUp ? ", dropping it" : ", will retry"}: ${err}`);
      outcome = giveUp ? "done" : "wait";
    }
    if (outcome === "wait") this.waiting.set(row.rowid, firstSeen);
    else this.waiting.delete(row.rowid);
  }

  private async handle(row: RawMessage, waitedMs: number): Promise<Outcome> {
    if (!row.chat_guid) return waitedMs < this.opts.chatWaitMs ? "wait" : "done";
    const chat = row.chat_guid;
    const isGroup = row.chat_style === GROUP_STYLE;

    if (row.is_from_me) {
      await this.handleOwn(row, chat, isGroup);
      return "done";
    }
    if (!row.handle) return "done";
    const sender = normalizeHandle(row.handle);

    if (row.item_type !== 0) {
      // Membership changes, renames, and similar; the roster diff picks up joins and leaves.
      if (isGroup && this.gate.groupEnabled(chat)) this.rosterDirty = true;
      return "done";
    }
    if (isGroup ? !this.gate.groupEnabled(chat) : !this.gate.readsDms() || !this.gate.isMember(sender)) return "done";

    const base = {
      message_id: row.guid,
      sender_phone: sender,
      is_dm: !isGroup,
      received_at: appleDate(row.date),
      ...(isGroup ? { group_id: chat } : {}),
    };

    if (isAssociated(row.associated_message_type)) {
      const reaction = tapback(row.associated_message_type);
      const target = reactionTarget(row.associated_message_guid);
      // Removed tapbacks, emoji tapbacks, stickers and poll votes aren't part of the contract.
      if (!reaction || !target) return "done";
      if (!isGroup && !this.gate.allowDm(sender, "", this.opts.now())) return "done";
      await this.hub.ingest({ ...base, kind: "reaction", reaction, reply_to_id: target });
      return "done";
    }

    const text = messageText(row);
    if (!isGroup && !this.gate.allowDm(sender, text, this.opts.now())) return "done";
    const replyTo = row.thread_originator_guid ? { reply_to_id: row.thread_originator_guid } : {};

    let photos: RawAttachment[] = [];
    if (row.cache_has_attachments) {
      const attachments = this.db.attachments([row.rowid]);
      const downloading = attachments.length === 0 || attachments.some((a) => isPhoto(a) && !isReady(a));
      if (downloading && waitedMs < this.opts.attachmentWaitMs) return "wait";
      photos = attachments.filter((a) => isPhoto(a) && isReady(a));
    }

    if (photos.length === 0) {
      if (text) await this.hub.ingest({ ...base, kind: "text", text, ...replyTo });
      return "done";
    }
    for (const [i, photo] of photos.entries()) {
      const image_url = await this.images.publish(photo.filename!);
      await this.hub.ingest({
        ...base,
        // Extra photos in the same bubble get their own ids; the first keeps the row's guid.
        message_id: i === 0 ? row.guid : `${row.guid}:${i}`,
        kind: "image",
        image_url,
        ...(i === 0 && text ? { text } : {}),
        ...replyTo,
      });
    }
    return "done";
  }

  /** From-me rows are Tab's own sends, the owner's commands, or the owner typing by hand. */
  private async handleOwn(row: RawMessage, chat: string, isGroup: boolean): Promise<void> {
    if (isAssociated(row.associated_message_type)) {
      const reaction = tapback(row.associated_message_type);
      const target = reactionTarget(row.associated_message_guid);
      if (reaction && target && !this.matcher.match(tapbackKey(target), reaction, false, row.guid)) {
        // Tab's phone tapbacked something nobody asked for: by hand, or the UI driver hit the wrong message.
        this.opts.log(`[bridge] unrequested ${reaction} from Tab's account on ${target}`);
      }
      return;
    }

    const key = isGroup ? chat : normalizeHandle(row.handle ?? row.chat_identifier ?? "");
    // The owner's own DMs are only read when Tab is waiting for one of its sends to that person.
    if (!isGroup && !this.matcher.expecting(key)) return;
    const text = messageText(row);
    if (this.matcher.match(key, text, row.cache_has_attachments === 1, row.guid)) return;
    if (!isGroup) return;

    const command = parseCommand(text, this.opts.commandPrefix);
    if (command === "on" && this.gate.enable(chat)) {
      this.opts.log(`[bridge] Tab is on in ${chat}`);
      await this.syncRosters();
    } else if (command === "off" && this.gate.disable(chat)) {
      this.opts.log(`[bridge] Tab is off in ${chat}`);
    }
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const fail = (error: string) => this.hub.markOutbox(row.action_id, { status: "failed", error });
    await this.hub.markOutbox(row.action_id, { status: "sending" });

    if (row.kind === "reaction") return this.deliverTapback(row, fail);
    const target = this.targetFor(row);
    if (typeof target === "string") return fail(target);
    const content = this.contentFor(row);
    if (typeof content === "string") return fail(content);

    const key = target.kind === "group" ? target.chatGuid : target.handle;
    if ("text" in content && row.target_message_id && (await this.deliverReply(row, key, content.text))) return;
    for (let attempt = 1; ; attempt++) {
      const expectation = this.matcher.expect(key, "text" in content ? content.text : null, this.opts.sendMatchTimeoutMs);
      try {
        await this.sender.send(target, content);
      } catch (err) {
        expectation.cancel();
        if (attempt >= MAX_SEND_ATTEMPTS) return fail(String(err));
        await Bun.sleep(attempt * 1000);
        continue;
      }
      if (target.kind === "dm") this.gate.noteBridgeDm(target.handle, this.opts.now());
      const guid = await expectation.landed;
      if (!guid) this.opts.log(`[bridge] ${row.action_id} sent, but never showed up in chat.db; tapbacks on it won't route`);
      await this.hub.markOutbox(row.action_id, {
        status: "sent",
        sent_at: new Date(this.opts.now()),
        ...(guid ? { sent_photon_id: guid } : {}),
      });
      return;
    }
  }

  /**
   * Sends a message as an inline reply to row.target_message_id, if that's
   * possible: the replier is on and the target is still the newest message in
   * its chat (Messages replies to the newest). Returns false, having sent
   * nothing, when the caller should fall back to a normal send.
   */
  private async deliverReply(row: OutboxRow, key: string, text: string): Promise<boolean> {
    const replier = this.opts.replier;
    if (!replier || !row.target_message_id) return false;
    const target = this.db.messageByGuid(row.target_message_id);
    if (!target?.chat_guid || this.db.latestInChat(target.chat_guid)?.guid !== target.guid) return false;

    const expectation = this.matcher.expect(key, text, this.opts.sendMatchTimeoutMs);
    try {
      await replier.reply(row.target_message_id, text);
    } catch (err) {
      expectation.cancel();
      this.opts.log(`[bridge] ${row.action_id} couldn't reply in thread (${err}); sending normally`);
      return false;
    }
    const guid = await expectation.landed;
    if (guid && this.db.messageByGuid(guid)?.thread_originator_guid !== row.target_message_id) {
      this.opts.log(`[bridge] ${row.action_id} was sent, but not in ${row.target_message_id}'s thread`);
    }
    if (!guid) this.opts.log(`[bridge] ${row.action_id} reply sent, but never showed up in chat.db`);
    await this.hub.markOutbox(row.action_id, {
      status: "sent",
      sent_at: new Date(this.opts.now()),
      ...(guid ? { sent_photon_id: guid } : {}),
    });
    return true;
  }

  /**
   * Tapbacks drive Messages' UI, so they get one attempt (a second press on the
   * same tapback would remove it), only go out while the target is the newest
   * message in its chat, and count as sent only once chat.db shows Tab's
   * tapback on the right message.
   */
  private async deliverTapback(row: OutboxRow, fail: (error: string) => Promise<void>): Promise<void> {
    if (!this.tapbacker) return fail("unsupported: tapbacks are off (TAPBACK_MODE=off)");
    if (!row.target_message_id || !row.reaction) return fail("reaction needs target_message_id and reaction");

    const target = this.db.messageByGuid(row.target_message_id);
    if (!target?.chat_guid) return fail(`no message ${row.target_message_id} in chat.db`);
    const allowed =
      target.chat_style === GROUP_STYLE
        ? this.gate.groupEnabled(target.chat_guid)
        : !!target.handle && this.gate.isMember(normalizeHandle(target.handle));
    if (!allowed) return fail(`refusing to tapback in ${target.chat_guid}: Tab isn't on there`);
    // Messages tapbacks the chat's last message, not the one the link opens, so only act while they're the same.
    if (this.db.latestInChat(target.chat_guid)?.guid !== target.guid) {
      return fail(`skipped: ${row.target_message_id} is no longer the newest message in its chat`);
    }

    const expectation = this.matcher.expect(tapbackKey(row.target_message_id), row.reaction, this.opts.tapbackVerifyMs);
    try {
      await this.tapbacker.react(row.target_message_id, row.reaction);
    } catch (err) {
      expectation.cancel();
      return fail(String(err));
    }
    const guid = await expectation.landed;
    if (!guid) return fail(`the ${row.reaction} never showed up on ${row.target_message_id} in chat.db`);
    await this.hub.markOutbox(row.action_id, { status: "sent", sent_at: new Date(this.opts.now()), sent_photon_id: guid });
  }

  /** Tab only ever speaks in enabled groups and to their members. */
  private targetFor(row: OutboxRow): Target | string {
    if (row.kind === "dm" || (row.kind === "contact_card" && !row.group_id)) {
      if (!row.to_phone) return `${row.kind} needs to_phone`;
      const handle = normalizeHandle(row.to_phone);
      if (!this.gate.isMember(handle)) return `refusing to DM ${handle}: not a member of an enabled group`;
      return { kind: "dm", handle };
    }
    if (!row.group_id) return `${row.kind} needs group_id`;
    if (!this.gate.groupEnabled(row.group_id)) return `refusing to post in ${row.group_id}: Tab isn't on there`;
    return { kind: "group", chatGuid: row.group_id };
  }

  private contentFor(row: OutboxRow): Outgoing | string {
    if (row.kind === "contact_card") {
      if (!this.opts.tabPhone) return "contact_card needs TAB_PHONE";
      const card = vcard(this.opts.tabName, this.opts.tabPhone);
      return { file: { name: `${this.opts.tabName}.vcf`, data: Buffer.from(card), mimeType: "text/vcard" } };
    }
    if (!row.text) return `${row.kind} needs text`;
    return { text: row.text };
  }
}

function tapbackKey(targetGuid: string): string {
  return `tapback:${targetGuid}`;
}

function isPhoto(a: RawAttachment): boolean {
  return (a.mime_type ?? "").startsWith("image/") || /^public\.(heic|heif|jpeg|png)$/.test(a.uti ?? "");
}

function isReady(a: RawAttachment): boolean {
  return a.transfer_state === TRANSFER_FINISHED && !!a.filename;
}

function systemMessage(group: string, handle: string, event: string, at: Date): InboundMessage {
  return {
    message_id: `${group}:${handle}:${event}:${at.getTime()}`,
    group_id: group,
    sender_phone: handle,
    is_dm: false,
    kind: "system",
    text: event,
    received_at: at,
  };
}

function vcard(name: string, phone: string): string {
  return ["BEGIN:VCARD", "VERSION:3.0", `FN:${name}`, `N:;${name};;;`, `TEL;type=CELL:${phone}`, "END:VCARD", ""].join("\r\n");
}
