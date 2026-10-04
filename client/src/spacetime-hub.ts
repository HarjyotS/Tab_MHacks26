import { Timestamp } from "spacetimedb";
import type { Hub } from "./hub.ts";
import { DbConnection, tables } from "./module_bindings/index.ts";
import type { InboundMessage, OutboxKind, OutboxRow, OutboxStatus, OutboxUpdate, Reaction } from "./types.ts";

export interface SpacetimeHubOptions {
  uri: string;
  database: string;
  /** Saved token for the client's identity; omit on first run to get a new one. */
  token?: string;
  onToken: (token: string) => void;
  /** Timezone for groups created by this client (SPEC 11.3 GROUP_TIMEZONE). */
  timezone: string;
  log: (line: string) => void;
  onDisconnect: (error?: Error) => void;
}

/**
 * The real hub: calls `ingest_message` and `mark_outbox`, and reads due rows
 * from the `client_outbox` view. The identity needs the "client" service role
 * (`npm run grant:role -- <identity> client`, run by the module owner).
 */
export async function spacetimeHub(opts: SpacetimeHubOptions): Promise<Hub & { identity: string; close(): void }> {
  let identity = "";
  const connection = await new Promise<DbConnection>((resolve, reject) => {
    let builder = DbConnection.builder()
      .withUri(opts.uri)
      .withDatabaseName(opts.database)
      .onConnect((conn, id, token) => {
        identity = id.toHexString();
        opts.onToken(token);
        resolve(conn);
      })
      .onConnectError((_ctx, error) => reject(error))
      .onDisconnect((_ctx, error) => opts.onDisconnect(error));
    if (opts.token) builder = builder.withToken(opts.token);
    builder.build();
  });

  await new Promise<void>((resolve, reject) => {
    connection
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(String(ctx.event))))
      .subscribe(tables.clientOutbox);
  });

  return {
    identity,
    async ingest(m: InboundMessage) {
      await connection.reducers.ingestMessage({
        messageId: m.message_id,
        groupId: m.group_id,
        // Opaque ids for the web ledger, used only when this message creates the group or member.
        groupLedgerId: m.group_id ? crypto.randomUUID() : undefined,
        // Sets the name on a new group and keeps it current when the chat is renamed.
        groupDisplayName: m.group_name,
        groupTimezone: opts.timezone,
        senderPhone: m.sender_phone,
        senderLedgerMemberId: crypto.randomUUID(),
        isDm: m.is_dm,
        kind: m.kind,
        text: m.text,
        imageUrl: m.image_url,
        replyToId: m.reply_to_id,
        reaction: m.reaction,
        receivedAt: Timestamp.fromDate(m.received_at),
      });
    },
    async markOutbox(actionId: string, update: OutboxUpdate) {
      await connection.reducers.markOutbox({
        actionId,
        status: update.status,
        sentPhotonId: update.sent_photon_id,
        error: update.error,
      });
    },
    dueOutbox(now: Date): OutboxRow[] {
      return [...connection.db.clientOutbox.iter()]
        .filter((r) => r.status === "queued" && r.sendAfter.toDate() <= now)
        .map((r) => ({
          action_id: r.actionId,
          kind: r.kind as OutboxKind,
          group_id: r.groupId,
          to_phone: r.toPhone,
          target_message_id: r.targetMessageId,
          text: r.text,
          reaction: r.reaction as Reaction | undefined,
          expense_id: r.expenseId,
          purpose: r.purpose,
          send_after: r.sendAfter.toDate(),
          status: r.status as OutboxStatus,
        }))
        .sort((a, b) => a.send_after.getTime() - b.send_after.getTime());
    },
    close: () => connection.disconnect(),
  };
}
