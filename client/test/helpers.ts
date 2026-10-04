import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Outgoing, Sender, Target } from "../src/sender.ts";
import { NotSentError } from "../src/messages-ui.ts";
import type { Replier } from "../src/reply.ts";
import type { Tapbacker } from "../src/tapback.ts";
import type { Reaction } from "../src/types.ts";

/** Real NSAttributedString typedstreams, archived on macOS with NSArchiver. */
export const ATTRIBUTED_BODIES = readFileSync(join(import.meta.dir, "fixtures", "attributed-body.b64"), "utf8")
  .trim()
  .split("\n")
  .map((line) => new Uint8Array(Buffer.from(line, "base64")));

export function appleNs(date: Date): number {
  return (date.getTime() - Date.UTC(2001, 0, 1)) * 1e6;
}

interface NewMessage {
  chat: string;
  handle?: string;
  fromMe?: boolean;
  text?: string | null;
  attributedBody?: Uint8Array;
  itemType?: number;
  associatedType?: number;
  associatedGuid?: string;
  threadOriginator?: string;
  hasAttachments?: boolean;
}

/** A throwaway chat.db with the tables and columns the bridge reads. */
export class FakeMessages {
  readonly path: string;
  private readonly db: Database;
  private nextGuid = 1;

  constructor(opts: { threadColumn?: boolean } = {}) {
    this.path = join(mkdtempSync(join(tmpdir(), "tab-chatdb-")), "chat.db");
    this.db = new Database(this.path, { create: true });
    this.db.exec(`
      CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, service TEXT);
      CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER,
                         chat_identifier TEXT, display_name TEXT);
      CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
      CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT,
                            attributedBody BLOB, handle_id INTEGER DEFAULT 0, is_from_me INTEGER DEFAULT 0,
                            date INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0,
                            associated_message_type INTEGER DEFAULT 0, associated_message_guid TEXT,
                            cache_has_attachments INTEGER DEFAULT 0
                            ${opts.threadColumn === false ? "" : ", thread_originator_guid TEXT"});
      CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT, filename TEXT, mime_type TEXT,
                               uti TEXT, transfer_state INTEGER DEFAULT 0);
      CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
    `);
  }

  handle(id: string): number {
    const found = this.db.query<{ ROWID: number }, [string]>("SELECT ROWID FROM handle WHERE id = ?").get(id);
    if (found) return found.ROWID;
    return Number(this.db.query("INSERT INTO handle (id, service) VALUES (?, 'iMessage')").run(id).lastInsertRowid);
  }

  group(guid: string, members: string[], name: string | null = null): string {
    const id = this.db
      .query("INSERT INTO chat (guid, style, chat_identifier, display_name) VALUES (?, 43, ?, ?)")
      .run(guid, guid.split(";").pop()!, name).lastInsertRowid;
    for (const m of members) this.join(guid, m);
    return guid;
  }

  dm(handle: string): string {
    const guid = `iMessage;-;${handle}`;
    if (!this.chatRowId(guid)) {
      this.db.query("INSERT INTO chat (guid, style, chat_identifier) VALUES (?, 45, ?)").run(guid, handle);
      this.join(guid, handle);
    }
    return guid;
  }

  join(chat: string, handle: string): void {
    this.db.query("INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (?, ?)").run(this.chatRowId(chat)!, this.handle(handle));
  }

  leave(chat: string, handle: string): void {
    this.db.query("DELETE FROM chat_handle_join WHERE chat_id = ? AND handle_id = ?").run(this.chatRowId(chat)!, this.handle(handle));
  }

  /** Inserts a message and returns its guid. */
  message(m: NewMessage): string {
    const guid = `GUID-${this.nextGuid++}`;
    const rowid = Number(
      this.db
        .query(
          `INSERT INTO message (guid, text, attributedBody, handle_id, is_from_me, date, item_type,
                                associated_message_type, associated_message_guid, cache_has_attachments
                                ${this.hasThreadColumn() ? ", thread_originator_guid" : ""})
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ? ${this.hasThreadColumn() ? ", ?" : ""})`,
        )
        .run(
          guid,
          m.text === undefined ? null : m.text,
          m.attributedBody ?? null,
          m.handle ? this.handle(m.handle) : 0,
          m.fromMe ? 1 : 0,
          appleNs(new Date()),
          m.itemType ?? 0,
          m.associatedType ?? 0,
          m.associatedGuid ?? null,
          m.hasAttachments ? 1 : 0,
          ...(this.hasThreadColumn() ? [m.threadOriginator ?? null] : []),
        ).lastInsertRowid,
    );
    this.db.query("INSERT INTO chat_message_join (chat_id, message_id) VALUES (?, ?)").run(this.chatRowId(m.chat)!, rowid);
    return guid;
  }

  /** Attaches a file to a message; returns the attachment ROWID. */
  attach(messageGuid: string, filename: string, mime: string, transferState: number): number {
    const msg = this.db.query<{ ROWID: number }, [string]>("SELECT ROWID FROM message WHERE guid = ?").get(messageGuid)!;
    const id = Number(
      this.db
        .query("INSERT INTO attachment (guid, filename, mime_type, transfer_state) VALUES (?, ?, ?, ?)")
        .run(`ATT-${filename}`, filename, mime, transferState).lastInsertRowid,
    );
    this.db.query("INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (?, ?)").run(msg.ROWID, id);
    return id;
  }

  /** The chat guid a message belongs to. */
  chatOf(messageGuid: string): string {
    return this.db
      .query<{ guid: string }, [string]>(
        `SELECT c.guid FROM message m JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
         JOIN chat c ON c.ROWID = cmj.chat_id WHERE m.guid = ?`,
      )
      .get(messageGuid)!.guid;
  }

  setTransferState(attachmentId: number, state: number): void {
    this.db.query("UPDATE attachment SET transfer_state = ? WHERE ROWID = ?").run(state, attachmentId);
  }

  private chatRowId(guid: string): number | undefined {
    return this.db.query<{ ROWID: number }, [string]>("SELECT ROWID FROM chat WHERE guid = ?").get(guid)?.ROWID;
  }

  private hasThreadColumn(): boolean {
    return this.db
      .query<{ name: string }, []>("PRAGMA table_info(message)")
      .all()
      .some((c) => c.name === "thread_originator_guid");
  }
}

/** Records sends and writes the from-me row Messages.app would have written. */
export class FakeSender implements Sender {
  readonly calls: { target: Target; content: Outgoing }[] = [];
  readonly sentGuids: string[] = [];
  private waiters: (() => void)[] = [];

  constructor(private readonly fx: FakeMessages) {}

  async send(target: Target, content: Outgoing): Promise<void> {
    this.calls.push({ target, content });
    const isText = "text" in content;
    const guid = this.fx.message({
      chat: target.kind === "group" ? target.chatGuid : this.fx.dm(target.handle),
      handle: target.kind === "dm" ? target.handle : undefined,
      fromMe: true,
      text: isText ? content.text : "￼",
      hasAttachments: !isText,
    });
    this.sentGuids.push(guid);
    for (const wake of this.waiters.splice(0)) wake();
  }

  nextSend(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async stop(): Promise<void> {}
}

const TAPBACK_CODES: Record<Reaction, number> = { love: 2000, like: 2001, dislike: 2002, laugh: 2003, emphasize: 2004, question: 2005 };

/** Writes the from-me tapback row Messages.app would have written, optionally on the wrong message. */
export class FakeTapbacker implements Tapbacker {
  readonly calls: { target: string; reaction: Reaction }[] = [];
  misfireOnto: string | null = null;
  private waiters: (() => void)[] = [];

  constructor(private readonly fx: FakeMessages) {}

  async react(target: string, reaction: Reaction, _chatTitle: string): Promise<void> {
    this.calls.push({ target, reaction });
    const landedOn = this.misfireOnto ?? target;
    this.fx.message({
      chat: this.fx.chatOf(landedOn),
      fromMe: true,
      text: `Liked a message`,
      associatedType: TAPBACK_CODES[reaction],
      associatedGuid: `p:0/${landedOn}`,
    });
    for (const wake of this.waiters.splice(0)) wake();
  }

  nextReact(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Writes the from-me inline-reply row Messages.app would have written. */
export class FakeReplier implements Replier {
  readonly calls: { target: string; text: string }[] = [];
  fail = false;
  /** Send the reply, then throw as if cleanup after Return failed. */
  failAfterSending = false;
  private waiters: (() => void)[] = [];

  constructor(private readonly fx: FakeMessages) {}

  async reply(target: string, text: string, _chatTitle: string): Promise<void> {
    this.calls.push({ target, text });
    if (this.fail) throw new NotSentError("NOT_SENT: Messages has no enabled Reply menu item for this message");
    this.fx.message({ chat: this.fx.chatOf(target), fromMe: true, text, threadOriginator: target });
    for (const wake of this.waiters.splice(0)) wake();
    if (this.failAfterSending) throw new Error("UI script timed out after 20000 ms");
  }

  nextReply(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
