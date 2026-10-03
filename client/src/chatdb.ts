import { Database } from "bun:sqlite";

/** One row of ~/Library/Messages/chat.db, joined with its sender and chat. */
export interface RawMessage {
  rowid: number;
  guid: string;
  text: string | null;
  attributedBody: Uint8Array | null;
  is_from_me: number;
  date: number;
  item_type: number;
  associated_message_type: number | null;
  associated_message_guid: string | null;
  thread_originator_guid: string | null;
  cache_has_attachments: number;
  /** Sender for inbound rows; the recipient for outbound DMs; null for outbound group rows. */
  handle: string | null;
  chat_guid: string | null;
  chat_identifier: string | null;
  /** 43 is a group chat, 45 a one-to-one chat. */
  chat_style: number | null;
}

export interface RawAttachment {
  message_rowid: number;
  filename: string | null;
  mime_type: string | null;
  uti: string | null;
  /** 5 means the file is fully on disk. */
  transfer_state: number | null;
}

export interface ChatSummary {
  guid: string;
  display_name: string | null;
  participants: number;
  last_message_at: Date | null;
}

/** What the bridge needs from chat.db. Tests swap in an in-memory fake. */
export interface ChatSource {
  maxRowId(): number;
  messagesAfter(rowid: number, limit: number): RawMessage[];
  messagesByRowId(rowids: number[]): RawMessage[];
  attachments(rowids: number[]): RawAttachment[];
  participants(chatGuids: string[]): Map<string, string[]>;
  messageByGuid(guid: string): RawMessage | null;
  latestInChat(chatGuid: string): RawMessage | null;
}

export const GROUP_STYLE = 43;

/**
 * Read-only access to the Messages database. Columns that only exist on some
 * macOS versions are detected at startup and read as NULL when missing, so the
 * same queries work on macOS 14, 15 and 26.
 */
export class ChatDb implements ChatSource {
  private readonly db: Database;
  private readonly messageSelect: string;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true });
    const columns = new Set(
      this.db.query<{ name: string }, []>("PRAGMA table_info(message)").all().map((c) => c.name),
    );
    const optional = (name: string) => (columns.has(name) ? `m.${name}` : `NULL AS ${name}`);
    this.messageSelect = `
      SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, m.is_from_me, m.date,
             m.item_type, m.associated_message_type, m.associated_message_guid,
             ${optional("thread_originator_guid")}, m.cache_has_attachments,
             h.id AS handle, c.guid AS chat_guid, c.chat_identifier, c.style AS chat_style
      FROM message m
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      LEFT JOIN chat c ON c.ROWID = (
        SELECT MIN(chat_id) FROM chat_message_join WHERE message_id = m.ROWID
      )`;
  }

  maxRowId(): number {
    return this.db.query<{ max: number | null }, []>("SELECT MAX(ROWID) AS max FROM message").get()?.max ?? 0;
  }

  messagesAfter(rowid: number, limit: number): RawMessage[] {
    return this.db
      .query<RawMessage, [number, number]>(`${this.messageSelect} WHERE m.ROWID > ? ORDER BY m.ROWID ASC LIMIT ?`)
      .all(rowid, limit);
  }

  messagesByRowId(rowids: number[]): RawMessage[] {
    if (rowids.length === 0) return [];
    return this.db
      .query<RawMessage, number[]>(`${this.messageSelect} WHERE m.ROWID IN (${marks(rowids)}) ORDER BY m.ROWID ASC`)
      .all(...rowids);
  }

  messageByGuid(guid: string): RawMessage | null {
    return this.db.query<RawMessage, [string]>(`${this.messageSelect} WHERE m.guid = ?`).get(guid);
  }

  /** The newest message in a chat from anyone, ignoring tapbacks and group events. */
  latestInChat(chatGuid: string): RawMessage | null {
    return this.db
      .query<RawMessage, [string]>(
        `${this.messageSelect}
         WHERE c.guid = ? AND m.item_type = 0
           AND (m.associated_message_type IS NULL OR m.associated_message_type = 0)
         ORDER BY m.ROWID DESC LIMIT 1`,
      )
      .get(chatGuid);
  }

  /** The newest message someone else sent in one of these chats, ignoring tapbacks. */
  latestIncoming(chatGuids: string[]): RawMessage | null {
    if (chatGuids.length === 0) return null;
    return this.db
      .query<RawMessage, string[]>(
        `${this.messageSelect}
         WHERE c.guid IN (${marks(chatGuids)}) AND m.is_from_me = 0 AND m.item_type = 0
           AND (m.associated_message_type IS NULL OR m.associated_message_type = 0)
         ORDER BY m.ROWID DESC LIMIT 1`,
      )
      .get(...chatGuids);
  }

  attachments(rowids: number[]): RawAttachment[] {
    if (rowids.length === 0) return [];
    return this.db
      .query<RawAttachment, number[]>(
        `SELECT maj.message_id AS message_rowid, a.filename, a.mime_type, a.uti, a.transfer_state
         FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id
         WHERE maj.message_id IN (${marks(rowids)}) ORDER BY a.ROWID ASC`,
      )
      .all(...rowids);
  }

  participants(chatGuids: string[]): Map<string, string[]> {
    const result = new Map<string, string[]>(chatGuids.map((g) => [g, []]));
    if (chatGuids.length === 0) return result;
    const rows = this.db
      .query<{ chat_guid: string; handle: string }, string[]>(
        `SELECT c.guid AS chat_guid, h.id AS handle
         FROM chat c
         JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
         JOIN handle h ON h.ROWID = chj.handle_id
         WHERE c.guid IN (${marks(chatGuids)})`,
      )
      .all(...chatGuids);
    for (const row of rows) result.get(row.chat_guid)?.push(row.handle);
    return result;
  }

  /** Recent group chats, for finding a chat guid by hand. */
  recentGroups(limit: number): ChatSummary[] {
    return this.db
      .query<{ guid: string; display_name: string | null; participants: number; last_date: number | null }, [number]>(
        `SELECT c.guid, c.display_name,
                (SELECT COUNT(*) FROM chat_handle_join WHERE chat_id = c.ROWID) AS participants,
                (SELECT MAX(m.date) FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
                 WHERE cmj.chat_id = c.ROWID) AS last_date
         FROM chat c WHERE c.style = ${GROUP_STYLE}
         ORDER BY last_date DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => ({
        guid: r.guid,
        display_name: r.display_name || null,
        participants: r.participants,
        last_message_at: r.last_date ? new Date(Date.UTC(2001, 0, 1) + r.last_date / 1e6) : null,
      }));
  }

  close(): void {
    this.db.close();
  }
}

function marks(values: unknown[]): string {
  return values.map(() => "?").join(", ");
}
